/* ============================================================
 * Agentic Chat — Application Logic
 *
 * Architecture (43 modules, all revealing-module-pattern IIFEs):
 *
 *   Core:
 *   SafeStorage          — safe localStorage wrapper for restricted-storage environments
 *   ChatConfig           — constants, model list, pricing, and runtime configuration
 *   ConversationManager  — history management (add, trim, clear, token estimation)
 *   SandboxRunner        — iframe sandbox for executing LLM-generated code
 *   ApiKeyManager        — OpenAI key + per-service key storage, modal handling
 *   UIController         — DOM updates, button state, character count
 *   ChatController       — orchestrates sending messages, processing responses
 *
 *   Features:
 *   PromptTemplates      — categorized prompt library with search and one-click insert
 *   HistoryPanel         — slide-out conversation history with export/import
 *   SnippetLibrary       — persistent code snippet storage with tagging and search
 *   MessageSearch        — full-text search across conversation messages
 *   ChatBookmarks        — bookmark individual messages for quick reference
 *   SlashCommands        — slash-command dropdown (autocomplete, keyboard nav)
 *   MessageReactions     — per-message emoji reactions with persistent counts
 *   KeyboardShortcuts    — global keyboard shortcuts with help modal
 *   VoiceInput           — browser speech recognition with language selection
 *   ThemeManager         — dark/light theme with OS preference detection
 *   SessionManager       — multi-session persistence with auto-save and quota mgmt
 *   CrossTabSync         — multi-tab conflict detection via storage events + BroadcastChannel
 *   ChatStats            — conversation analytics (word counts, code blocks, timing)
 *   CostDashboard        — persistent API spend tracker with budget alerts
 *   PersonaPresets       — switchable system prompt presets with custom persona support
 *   ModelSelector        — model picker with localStorage persistence
 *   FileDropZone         — drag-and-drop file inclusion (text-based files, 100 KB limit)
 *   FocusMode            — distraction-free zen mode (Ctrl+Shift+F)
 *   InputHistory         — navigate previous prompts with ↑/↓ arrow keys
 *   Scratchpad           — persistent notepad panel with copy/insert/download actions
 *   ResponseTimeBadge    — response time indicator below token usage area
 *   ConversationFork     — branch conversations from any message into new sessions
 *   QuickReplies         — contextual follow-up suggestion chips after AI responses
 *   MessagePinning       — pin important messages to a floating quick-jump bar
 *   ReadAloud            — text-to-speech for messages with voice/speed controls
 *   MessageDiff          — compare any two messages with visual line-level diff
 *   ConversationTimeline — visual minimap sidebar for conversation navigation
 *   ConversationSummarizer — heuristic conversation summary with topics, decisions, action items
 *   MessageAnnotations   — private notes/annotations on messages with labels
 *   ConversationChapters — named section dividers with TOC navigation
 *   ConversationTags     — colored tag labels on sessions with filtering and management
 *   FormattingToolbar    — markdown formatting buttons above chat input
 *   GlobalSessionSearch  — full-text search across all saved sessions
 *   AutoTagger           — heuristic topic detection and automatic tag suggestions
 *   ResponseRating       — thumbs up/down ratings on AI responses with model satisfaction dashboard
 *   ConversationMerge    — combine 2+ sessions into one merged conversation (chronological interleave)
 *   ConversationReplay   — message-by-message playback with transport controls
 *   PromptLibrary        — user-created prompt snippets with folders, search, usage tracking, import/export
 *   MessageTranslator    — inline message translation to 20+ languages via OpenAI API
 *   MessageEditor        — edit & resend user messages (truncate + reload into input)
 *   SmartRetry           — automatic retry with exponential backoff for transient API failures
 *   UsageHeatmap         — GitHub-style 7×24 activity heatmap across all sessions
 *   ConversationAgenda   — per-session goal checklist with progress tracking
 *
 * All modules communicate through a thin public API; no direct DOM
 * manipulation outside UIController except where unavoidable (sandbox).
 * ============================================================ */

'use strict';

/* ---------- Safe localStorage helper ---------- */
/**
 * Wraps localStorage access so the app works in private-browsing or
 * restricted-storage environments where localStorage may throw.
 */
const SafeStorage = (() => {
  let available = false;
  try {
    const k = '__ac_storage_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    available = true;
  } catch (_) { /* storage unavailable */ }

  return {
    get(key) {
      try { return available ? localStorage.getItem(key) : null; } catch (_) { return null; }
    },
    set(key, value) {
      if (!available) return;
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // Propagate quota errors so callers can detect write failures.
        // Swallow SecurityError (storage revoked after initial check).
        if (e instanceof DOMException && e.name === 'SecurityError') return;
        throw e;
      }
    },
    remove(key) {
      try { if (available) localStorage.removeItem(key); } catch (_) { /* ignore */ }
    },
    get length() {
      try { return available ? localStorage.length : 0; } catch (_) { return 0; }
    },
    key(i) {
      try { return available ? localStorage.key(i) : null; } catch (_) { return null; }
    },
    isAvailable() { return available; },
  };
})();

/* ============================================================
 * ChatConfig — application constants and runtime configuration.
 *
 * Centralizes all tunables: model selection, token limits, input
 * constraints, sandbox timeout, streaming toggle, system prompt,
 * and per-model pricing.  Model selection and streaming preference
 * persist in localStorage via SafeStorage.  All other modules read
 * from ChatConfig rather than hard-coding values.
 *
 * @namespace ChatConfig
 * ============================================================ */
const ChatConfig = (() => {
  const _cfg = {
    _model: SafeStorage.get('ac-selected-model') || 'gpt-4.1',
    MAX_TOKENS_RESPONSE: 4096,
    MAX_HISTORY_PAIRS: 20,
    MAX_INPUT_CHARS: 50000,
    MAX_TOTAL_TOKENS: 100000,
    CHARS_PER_TOKEN: 4,
    TOKEN_WARNING_THRESHOLD: 80000,
    SANDBOX_TIMEOUT_MS: 30000,
    STREAMING_ENABLED: JSON.parse(SafeStorage.get('ac-streaming') ?? 'true'),
    SYSTEM_PROMPT: `
You are an autonomous agent in a browser.
Only reply with JavaScript in a single code block.
If an external service needs a key use the placeholder "YOUR_API_KEY".
Always \`return\` the final value.
    `.trim(),
    AVAILABLE_MODELS: [
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'o3', label: 'o3' },
      { id: 'o3-mini', label: 'o3 Mini' },
      { id: 'o4-mini', label: 'o4 Mini' }
    ],
    /** Per-model pricing in USD per 1M tokens: [input, output]. */
    MODEL_PRICING: {
      'gpt-4.1':        [2.00,   8.00],
      'gpt-4.1-mini':   [0.40,   1.60],
      'gpt-4.1-nano':   [0.10,   0.40],
      'gpt-4o':         [2.50,  10.00],
      'gpt-4o-mini':    [0.15,   0.60],
      'o3':             [2.00,   8.00],
      'o3-mini':        [1.10,   4.40],
      'o4-mini':        [1.10,   4.40]
    },
    get MODEL() { return _cfg._model; },
    set MODEL(v) { _cfg._model = v; try { SafeStorage.set('ac-selected-model', v); } catch (_) {} }
  };
  return _cfg;
})();

/* ---------- Shared Utilities ---------- */

/** Format an ISO timestamp as relative time (e.g. "2h ago", "3d ago"). */
function formatRelativeTime(isoString) {
  let now = Date.now();
  const then = new Date(isoString).getTime();
  let diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  return new Date(isoString).toLocaleDateString();
}

/** Trigger a browser file download from in-memory content. */
function downloadBlob(filename, content, mimeType) {
  let blob = new Blob([content], { type: mimeType });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Storage Sanitizer ---------- */
/**
 * Defence-in-depth: strips prototype-pollution keys (__proto__, constructor,
 * prototype) from objects parsed out of localStorage / imported JSON.
 * Without this, a tampered localStorage entry like {"__proto__": {"isAdmin": true}}
 * would pollute Object.prototype when assigned to a plain object variable.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeStorageObject(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeStorageObject);
  const clean = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const val = obj[key];
    clean[key] = (val !== null && typeof val === 'object')
      ? sanitizeStorageObject(val)
      : val;
  }
  return clean;
}

/* ---------- Shared HTML Escape ---------- */
/**
 * Escape HTML special characters to prevent XSS in rendered content.
 * Used by ChatStats, CostDashboard, PersonaPresets, HistoryPanel,
 * ConversationTimeline, and GlobalSessionSearch.
 */
function _escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Conversation Manager ---------- */
/**
 * Manages the conversation message history sent to the OpenAI API.
 *
 * Maintains a rolling window of user/assistant message pairs with automatic
 * trimming when the estimated token count exceeds `ChatConfig.MAX_TOTAL_TOKENS`.
 * Tracks character counts (used as a proxy for token estimation at ~4 chars/token)
 * and exposes getters for history introspection, clearing, and serialization.
 *
 * @namespace ConversationManager
 */
const ConversationManager = (() => {
  const history = [{ role: 'system', content: ChatConfig.SYSTEM_PROMPT }];
  let cachedCharCount = ChatConfig.SYSTEM_PROMPT.length;
  let charCountDirty = false;

  /** Recompute cached character count from the full message history. */
  function recomputeCharCount() {
    cachedCharCount = history.reduce((sum, m) => sum + m.content.length, 0);
    charCountDirty = false;
  }

  /** Response time tracking: array of { responseTimeMs, timestamp } for each assistant reply. */
  const responseTimes = [];
  let showTimingBadges = JSON.parse(SafeStorage.get('ac-show-timing') || 'true');

  return {
    getHistory()   { return history; },
    getMessages()  { return [...history]; },
    getResponseTimes() { return [...responseTimes]; },
    isTimingVisible() { return showTimingBadges; },
    toggleTiming() {
      showTimingBadges = !showTimingBadges;
      try { SafeStorage.set('ac-show-timing', JSON.stringify(showTimingBadges)); } catch (_) {}
      return showTimingBadges;
    },

    addMessage(role, content, meta) {
      const entry = { role, content, timestamp: Date.now() };
      if (meta && meta.responseTimeMs !== undefined) {
        entry.responseTimeMs = meta.responseTimeMs;
        entry.timestamp = meta.timestamp || entry.timestamp;
        responseTimes.push({ responseTimeMs: meta.responseTimeMs, timestamp: entry.timestamp });
      }
      history.push(entry);
      cachedCharCount += content.length;
    },

    /** Remove the last message (used on API failure). */
    popLast() {
      if (history.length > 1) {
        const removed = history.pop();
        cachedCharCount -= removed.content.length;
      }
    },

    /** Keep at most MAX_HISTORY_PAIRS user+assistant exchanges. */
    trim() {
      const messages = history.slice(1);
      const max = ChatConfig.MAX_HISTORY_PAIRS * 2;
      if (messages.length > max) {
        const trimmed = messages.slice(messages.length - max);
        history.length = 0;
        history.push({ role: 'system', content: ChatConfig.SYSTEM_PROMPT }, ...trimmed);
        charCountDirty = true;
      }
    },

    clear() {
      history.length = 0;
      history.push({ role: 'system', content: ChatConfig.SYSTEM_PROMPT });
      cachedCharCount = ChatConfig.SYSTEM_PROMPT.length;
      charCountDirty = false;
      responseTimes.length = 0;
    },

    /** Update the system prompt in-place (keeps conversation history). */
    setSystemPrompt(prompt) {
      if (history.length > 0 && history[0].role === 'system') {
        cachedCharCount -= history[0].content.length;
        history[0].content = prompt;
        cachedCharCount += prompt.length;
      }
    },

    /**
     * Rough token estimate based on character count.
     * Uses a cached character count that is incrementally maintained
     * on addMessage/popLast/clear and only recomputed after trim.
     */
    estimateTokens() {
      if (charCountDirty) recomputeCharCount();
      return Math.ceil(cachedCharCount / ChatConfig.CHARS_PER_TOKEN);
    },

    /**
     * Truncate history to keep only messages up to (but not including)
     * the given index.  Preserves the system message at index 0.
     * Used by MessageEditor to rewind the conversation for re-sending.
     *
     * @param {number} historyIndex — index into getHistory(); messages
     *   from this index onward are removed.
     */
    truncateAt(historyIndex) {
      if (historyIndex < 1) return;
      if (historyIndex >= history.length) return;
      history.splice(historyIndex);
      charCountDirty = true;
      // Prune response times that reference removed messages
      const assistantCount = history.filter(m => m.role === 'assistant').length;
      responseTimes.length = Math.min(responseTimes.length, assistantCount);
    }
  };
})();

/* ---------- Sandbox Runner ---------- */
/**
 * Secure iframe sandbox for executing LLM-generated JavaScript code.
 *
 * Creates a disposable `<iframe>` with `sandbox="allow-scripts"` to run
 * untrusted code in an isolated context. Communication is done via
 * `postMessage` with nonce-verified origin checking. Supports a configurable
 * timeout ({@link ChatConfig.SANDBOX_TIMEOUT_MS}) after which execution is
 * forcefully terminated. Only one sandbox can run at a time.
 *
 * @namespace SandboxRunner
 */
const SandboxRunner = (() => {
  let cleanupFn = null;

  /**
   * Execute code inside a sandboxed iframe.
   * Returns a Promise that resolves with { ok, value }.
   *
   * If a previous sandbox is still running, it is cancelled first
   * to prevent promise/timer/listener leaks.
   */
  function run(code) {
    // Cancel any in-flight execution to prevent leaking the old
    // promise, its setTimeout, and its message-event listener.
    if (cleanupFn) cleanupFn();

    return new Promise((resolve) => {
      const nonce = crypto.randomUUID();

      const iframeHTML = `<!DOCTYPE html><html><head>` +
        `<meta http-equiv="Content-Security-Policy" ` +
        `content="default-src 'none'; script-src 'unsafe-inline'; connect-src https:;">` +
        `</head><body><script>
        window.addEventListener('message', async function handler(evt) {
          if (!evt.data || evt.data.type !== 'sandbox-exec') return;
          window.removeEventListener('message', handler);
          let code = evt.data.code;
          let nonce = evt.data.nonce;
          try {
            const fn = new Function('return (async () => {' + code + '})()');
            const __result = await fn();
            parent.postMessage({ type:'sandbox-result', nonce:nonce, ok:true, value:String(__result) }, '*');
          } catch(e) {
            parent.postMessage({ type:'sandbox-result', nonce:nonce, ok:false, value:'Error: '+e.message }, '*');
          }
        });
        parent.postMessage({ type:'sandbox-ready' }, '*');
        <\/script></body></html>`;

      // Remove previous sandbox
      const prev = document.getElementById('sandbox-frame');
      if (prev) prev.remove();

      const iframe = document.createElement('iframe');
      iframe.id = 'sandbox-frame';
      iframe.sandbox = 'allow-scripts';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, value: '(sandbox timed out after 30s)' });
      }, ChatConfig.SANDBOX_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        const f = document.getElementById('sandbox-frame');
        if (f) f.remove();
        cleanupFn = null;
      }

      cleanupFn = () => {
        cleanup();
        resolve({ ok: false, value: '(execution cancelled)' });
      };

      function onMessage(e) {
        if (e.origin !== 'null') return;

        if (e.data && e.data.type === 'sandbox-ready') {
          iframe.contentWindow.postMessage({
            type: 'sandbox-exec', code, nonce
          }, '*');
          return;
        }

        if (e.data && e.data.type === 'sandbox-result' && e.data.nonce === nonce) {
          cleanup();
          resolve({ ok: e.data.ok, value: e.data.value });
        }
      }

      window.addEventListener('message', onMessage);
      iframe.srcdoc = iframeHTML;
    });
  }

  /** Cancel the currently running sandbox execution, if any. */
  function cancel() {
    if (cleanupFn) cleanupFn();
  }

  /** Return whether a sandbox execution is currently in progress. */
  function isRunning() {
    return cleanupFn !== null;
  }

  return { run, cancel, isRunning };
})();

/* ---------- API Key Manager ---------- */
/**
 * Manages API keys for OpenAI and per-service third-party integrations.
 *
 * Stores the OpenAI key (session-scoped, not persisted) and auto-detects
 * service-specific API keys when LLM code references external domains.
 * Handles the key-input modal flow: detects `YOUR_API_KEY` placeholders,
 * prompts the user, sanitizes keys to prevent injection, and substitutes
 * them into the code before execution.
 *
 * @namespace ApiKeyManager
 */
const ApiKeyManager = (() => {
  let openaiKey = null;
  const serviceKeys = {};
  let pendingCode = null;
  let pendingDomain = null;

  /** Get the current OpenAI API key (session-scoped, not persisted). */
  function getOpenAIKey()       { return openaiKey; }
  /**
   * Set the OpenAI API key after validating its format.
   * @param {string} key - Must start with "sk-" followed by 6+ alphanumeric chars.
   * @throws {Error} If the key format is invalid.
   */
  function setOpenAIKey(key)    {
    // Validate key format: OpenAI keys start with "sk-" followed by alphanumerics
    if (!/^sk-[A-Za-z0-9_-]{6,}$/.test(key)) {
      throw new Error('Invalid API key format. OpenAI keys start with "sk-".');
    }
    openaiKey = key;
  }
  /** Clear the stored OpenAI API key. */
  function clearOpenAIKey()     { openaiKey = null; }

  /**
   * Extract the hostname from the first URL found in code.
   * Used to identify which third-party service needs an API key.
   * @param {string} code - Source code that may contain URLs.
   * @returns {string} The hostname, or "Unknown Service" if no URL found.
   */
  function extractDomain(code) {
    const m = code.match(/https?:\/\/([^/'"]+)/);
    return m ? m[1] : 'Unknown Service';
  }

  /**
   * If code contains YOUR_API_KEY, prompt the user or substitute
   * a previously stored key. Returns the substituted code.
   * Returns null if user must still provide the key (modal shown).
   */
  function substituteServiceKey(code) {
    if (!/YOUR_API_KEY/.test(code)) return code;

    const domain = extractDomain(code);
    if (serviceKeys[domain]) {
      return code.replace(/YOUR_API_KEY/g, sanitizeKeyForCodeInjection(serviceKeys[domain]));
    }

    // Show modal — store pending state
    pendingCode = code;
    pendingDomain = domain;
    return null; // caller should not run yet
  }

  /**
   * Escape a key value so it is safe to substitute into JS code strings.
   * Prevents breakout via quotes, backslashes, backticks, newlines,
   * null bytes, and Unicode line terminators (U+2028/U+2029) which are
   * valid JavaScript line terminators that can break string literals.
   */
  function sanitizeKeyForCodeInjection(key) {
    return key
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\0/g, '')                       // Strip null bytes
      .replace(/\u2028/g, '\\u2028')            // Line Separator — JS line terminator
      .replace(/\u2029/g, '\\u2029');           // Paragraph Separator — JS line terminator
  }

  /** Called when the user submits a key in the modal. */
  function submitServiceKey(key) {
    if (!key || !pendingDomain) return null;
    serviceKeys[pendingDomain] = key;
    const code = pendingCode.replace(/YOUR_API_KEY/g, sanitizeKeyForCodeInjection(key));
    pendingCode = pendingDomain = null;
    return code;
  }

  /** Get the domain awaiting a service key from the user, or null. */
  function getPendingDomain() { return pendingDomain; }

  /**
   * Clear all stored service keys. Prevents stale third-party API
   * credentials from lingering in memory after a session ends.
   */
  function clearServiceKeys() {
    for (var k in serviceKeys) {
      if (Object.prototype.hasOwnProperty.call(serviceKeys, k)) {
        delete serviceKeys[k];
      }
    }
  }

  /**
   * Purge all sensitive key material — OpenAI key, per-service keys,
   * and any pending code/domain state. Call on conversation clear or
   * session switch to prevent credential leakage across contexts.
   */
  function clearAll() {
    openaiKey = null;
    clearServiceKeys();
    pendingCode = null;
    pendingDomain = null;
  }

  return {
    getOpenAIKey, setOpenAIKey, clearOpenAIKey,
    clearServiceKeys, clearAll,
    substituteServiceKey, submitServiceKey,
    getPendingDomain, extractDomain
  };
})();

/* ---------- UI Controller ---------- */
/**
 * Centralized DOM manipulation layer for all non-sandbox UI updates.
 *
 * Provides cached element lookups, button state toggling, character-count
 * display, and convenience methods for setting text content in the chat
 * output, console output, and last-prompt areas. All other modules should
 * go through UIController rather than touching the DOM directly.
 *
 * @namespace UIController
 */
const UIController = (() => {
  // Cache DOM references on first access to avoid repeated getElementById lookups.
  // Uses a lazy cache that populates on DOMContentLoaded or first call.
  const _cache = {};
  /**
   * Cached getElementById lookup. Memoizes DOM references to avoid
   * repeated lookups on every UI update.
   * @param {string} id - DOM element ID.
   * @returns {HTMLElement|null}
   */
  function el(id) {
    let node = _cache[id];
    if (!node) {
      node = document.getElementById(id);
      if (node) _cache[id] = node;
    }
    return node;
  }

  /** Set the chat output area to the given text (replaces content). */
  // Streaming text node — kept as module-level state so appendChatOutput
  // can append in O(1) instead of the old textContent += which was O(n²)
  // (read full string → concat → write back on every single token).
  let _streamNode = null;
  function setChatOutput(text) {
    const out = el('chat-output');
    out.textContent = text;
    // Reset streaming node; appendChatOutput will lazily create a new one.
    _streamNode = null;
  }
  /** Append text to the chat output area (used during streaming).
   *  Uses a dedicated Text node so each token append is O(1) via
   *  nodeValue mutation rather than reading + rewriting the entire
   *  container's textContent (which was O(n) per call, making a
   *  full stream O(n²) in total tokens).
   */
  function appendChatOutput(text) {
    if (!_streamNode) {
      _streamNode = document.createTextNode('');
      el('chat-output').appendChild(_streamNode);
    }
    _streamNode.data += text;
  }
  /**
   * Set the console/sandbox output area text and optional color.
   * @param {string} text - Output text to display.
   * @param {string} [color] - CSS color value for the text.
   */
  function setConsoleOutput(text, color) {
    const out = el('console-output');
    out.textContent = text;
    if (color) out.style.color = color;
  }
  /** Display the last user prompt in the prompt echo area. */
  function setLastPrompt(text)    { el('last-prompt').textContent = text; }

  /**
   * Toggle the UI between sending and idle states.
   * Disables the send button and input field while a request is in flight.
   * @param {boolean} sending - True to enter sending state.
   */
  function setSendingState(sending) {
    const btn = el('send-btn');
    const input = el('chat-input');
    btn.disabled = sending;
    btn.textContent = sending ? 'Sending…' : 'Send';
    input.disabled = sending;
  }

  /**
   * Show or hide the cancel button and update the send button label
   * while sandbox code is executing.
   * @param {boolean} running - True if sandbox is currently executing.
   */
  function setSandboxRunning(running) {
    el('cancel-btn').style.display = running ? 'inline-block' : 'none';
    if (running) {
      const btn = el('send-btn');
      btn.disabled = true;
      btn.textContent = 'Running…';
    }
  }

  /** Reset sandbox UI to idle state after execution completes. */
  function resetSandboxUI() {
    setSandboxRunning(false);
    const btn = el('send-btn');
    btn.disabled = false;
    btn.textContent = 'Send';
  }

  /**
   * Display token usage and estimated cost in the token-usage bar.
   * Computes cost using per-model pricing from ChatConfig.MODEL_PRICING.
   * @param {Object} usage - OpenAI usage object with prompt_tokens and completion_tokens.
   */
  function showTokenUsage(usage) {
    if (!usage) return;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = usage.total_tokens || (prompt + completion);
    const pricing = ChatConfig.MODEL_PRICING[ChatConfig.MODEL] || [2.50, 10.00];
    const cost = (prompt * pricing[0] + completion * pricing[1]) / 1_000_000;
    el('token-usage').textContent =
      `Tokens: ${prompt} in / ${completion} out (${total} total) · ~$${cost.toFixed(4)}`;
  }

  /** Show the API key input field in the toolbar if not already visible. */
  function showApiKeyInput() {
    if (el('api-key')) return;
    const toolbar = document.querySelector('.toolbar[aria-label="API key entry"]');
    if (!toolbar) return;
    const inp = document.createElement('input');
    inp.id = 'api-key';
    inp.type = 'password';
    inp.placeholder = 'OpenAI API Key';
    inp.autocomplete = 'off';
    toolbar.appendChild(inp);
    // Invalidate cache since we added a new element
    _cache['api-key'] = inp;
    inp.focus();
  }

  /** Remove the API key input field from the toolbar and clear its value. */
  function removeApiKeyInput() {
    const inp = el('api-key');
    if (inp) {
      inp.value = '';
      inp.remove();
      delete _cache['api-key'];
    }
  }

  /**
   * Show the service API key modal for the given domain.
   * @param {string} domain - The third-party service hostname requiring a key.
   */
  function showServiceKeyModal(domain) {
    el('api-service-name').textContent = domain;
    el('apikey-modal').style.display = 'flex';
    el('user-api-key').focus();
  }

  /** Hide the service API key modal and clear its input. */
  function hideServiceKeyModal() {
    el('apikey-modal').style.display = 'none';
    el('user-api-key').value = '';
  }

  /** Get the trimmed value of the chat input field. */
  function getChatInput()   { return el('chat-input').value.trim(); }
  /** Clear the chat input field and return focus to it. */
  function clearChatInput() { const inp = el('chat-input'); inp.value = ''; inp.focus(); }
  /** Set the chat input field value and return focus to it. */
  function setChatInput(text) { const inp = el('chat-input'); inp.value = text; inp.focus(); }
  /** Get the trimmed API key input value, or empty string if field is absent. */
  function getApiKeyInput() { const inp = el('api-key'); return inp ? inp.value.trim() : ''; }
  /** Get the trimmed service key input value from the modal. */
  function getServiceKeyInput() { return el('user-api-key').value.trim(); }

  /**
   * Display a code snippet in the chat output area inside a <pre> block.
   * @param {string} code - The code to display.
   */
  function displayCode(code) {
    const container = el('chat-output');
    container.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = code;
    container.appendChild(pre);
  }

  /**
   * Update the character count display. Shows a warning when the
   * input exceeds 80% of MAX_INPUT_CHARS, red when over the limit.
   * @param {number} len - Current character count.
   */
  function updateCharCount(len) {
    const counter = el('char-count');
    if (len > ChatConfig.MAX_INPUT_CHARS * 0.8) {
      counter.textContent = `${len.toLocaleString()} / ${ChatConfig.MAX_INPUT_CHARS.toLocaleString()} chars`;
      counter.style.color = len > ChatConfig.MAX_INPUT_CHARS ? '#ef4444' : '#f59e0b';
    } else {
      counter.textContent = '';
    }
  }

  return {
    setChatOutput, appendChatOutput, setConsoleOutput, setLastPrompt,
    setSendingState, setSandboxRunning, resetSandboxUI,
    showTokenUsage, showApiKeyInput, removeApiKeyInput,
    showServiceKeyModal, hideServiceKeyModal,
    getChatInput, clearChatInput, setChatInput, getApiKeyInput, getServiceKeyInput,
    displayCode, updateCharCount
  };
})();

/* ---------- Chat Controller ---------- */
/**
 * Orchestrates the send → LLM → sandbox → display pipeline.
 *
 * Handles user input submission, calls the OpenAI chat completions API,
 * extracts code blocks from responses, and dispatches them to
 * {@link SandboxRunner}. Also manages conversation display (appending
 * message bubbles with Markdown rendering), history clearing, and the
 * copy/retry affordances on individual messages.
 *
 * @namespace ChatController
 */
const ChatController = (() => {
  let isSending = false;
  let currentAbortController = null;

  /** Abort any in-flight API request. */
  function abortCurrentRequest() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }

  /** Create an AbortSignal that fires on user cancel OR after a timeout (ms). */
  function createRequestSignal(timeoutMs = 60000) {
    currentAbortController = new AbortController();
    // Combine user-cancel with auto-timeout
    if (typeof AbortSignal.timeout === 'function') {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      return AbortSignal.any
        ? AbortSignal.any([currentAbortController.signal, timeoutSignal])
        : currentAbortController.signal; // fallback for older browsers
    }
    return currentAbortController.signal;
  }

  /**
   * Build a user-friendly error result from a non-ok fetch Response.
   * Shared by callOpenAI and callOpenAIStreaming to avoid duplicating
   * the status-code interpretation and body-parsing logic.
   */
  async function buildErrorResult(rsp) {
    let errMsg = `OpenAI error ${rsp.status}`;
    try {
      const body = await rsp.json();
      if (body?.error?.message) errMsg += `: ${body.error.message}`;
    } catch (_) {}

    if (rsp.status === 401) errMsg += ' — check your API key';
    else if (rsp.status === 429) errMsg += ' — rate limited, try again shortly';
    else if (rsp.status === 503) errMsg += ' — service temporarily unavailable';

    return { ok: false, status: rsp.status, error: errMsg };
  }

  /**
   * Send a non-streaming chat completion request to the OpenAI API.
   * Aborts any in-flight request before starting a new one.
   * @param {string} key - OpenAI API key.
   * @param {Array<{role: string, content: string}>} messages - Conversation history.
   * @returns {Promise<{ok: boolean, data?: Object, status?: number, error?: string}>}
   */
  async function callOpenAI(key, messages) {
    abortCurrentRequest();
    const signal = createRequestSignal();

    const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: ChatConfig.MODEL,
        messages,
        max_tokens: ChatConfig.MAX_TOKENS_RESPONSE
      }),
      signal
    });

    if (!rsp.ok) {
      return buildErrorResult(rsp);
    }

    currentAbortController = null;
    return { ok: true, data: await rsp.json() };
  }

  /**
   * Stream a chat completion from OpenAI, calling onToken(text) for each chunk.
   * Returns the full reply text and estimated token usage.
   */
  async function callOpenAIStreaming(key, messages, onToken) {
    abortCurrentRequest();
    const signal = createRequestSignal();

    const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: ChatConfig.MODEL,
        messages,
        max_tokens: ChatConfig.MAX_TOKENS_RESPONSE,
        stream: true
      }),
      signal
    });

    if (!rsp.ok) {
      return buildErrorResult(rsp);
    }

    const reader = rsp.body.getReader();
    const decoder = new TextDecoder();
    // Collect chunks in an array and join once at the end.
    // The old `fullText += delta` was O(n²) because JS strings are
    // immutable — every += allocates a new string and copies the
    // entire previous content.  Array.push + join is O(n) amortised.
    const chunks = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            chunks.push(delta);
            onToken(delta);
          }
        } catch (_) { /* skip malformed chunks */ }
      }
    }

    const fullText = chunks.join('');

    // Estimate tokens since streaming doesn't return usage
    const promptTokens = Math.ceil(
      messages.reduce((sum, m) => sum + m.content.length, 0) / ChatConfig.CHARS_PER_TOKEN
    );
    const completionTokens = Math.ceil(fullText.length / ChatConfig.CHARS_PER_TOKEN);

    currentAbortController = null;

    return {
      ok: true,
      text: fullText,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  }

  /**
   * Rollback the last user message if the API call failed before getting
   * an assistant reply.  Shared by the error-result handler and the
   * catch block (abort, timeout, network error).
   */
  function _rollbackLastUserMessage() {
    const h = ConversationManager.getHistory();
    if (h.length > 1 && h.at(-1).role === 'user') {
      ConversationManager.popLast();
    }
  }

  /**
   * Handle a non-ok API result uniformly for both streaming and
   * non-streaming paths.  Rolls back the optimistic user message,
   * surfaces the error, and re-shows the API key input on 401.
   *
   * @param {{ok: false, status?: number, error?: string}} result
   */
  function _handleApiError(result) {
    _rollbackLastUserMessage();
    UIController.setChatOutput(result.error);
    UIController.setConsoleOutput('(request failed)');

    if (result.status === 401) {
      ApiKeyManager.clearOpenAIKey();
      UIController.showApiKeyInput();
    }
  }

  /** Execute sandbox code, handling service-key substitution. Returns false on error. */
  async function executeCode(code) {
    const substituted = ApiKeyManager.substituteServiceKey(code);
    if (substituted === null) {
      // Need a service key from user — modal is shown via UI
      UIController.showServiceKeyModal(ApiKeyManager.getPendingDomain());
      return false;
    }
    return await runInSandbox(substituted);
  }

  /**
   * Execute code in the sandboxed iframe and display the result.
   * Updates console output with the result and resets sandbox UI on completion.
   * @param {string} code - JavaScript code to execute in the sandbox.
   * @returns {Promise<boolean>} True if execution succeeded.
   */
  async function runInSandbox(code) {
    UIController.setConsoleOutput('(running in sandbox…)');
    UIController.setSandboxRunning(true);

    const result = await SandboxRunner.run(code);

    UIController.setConsoleOutput(result.value, result.ok ? '#4ade80' : '#f87171');
    UIController.resetSandboxUI();
    return result.ok;
  }

  /**
   * Main send handler: validates input, calls OpenAI (streaming or not),
   * extracts and executes code blocks, updates conversation history,
   * shows token usage, and triggers auto-save.
   *
   * On first call, captures the API key from the key input field.
   * Handles abort, timeout, and network errors with rollback.
   */
  async function send() {
    if (isSending) return;

    const prompt = UIController.getChatInput();

    // First send: capture OpenAI key
    if (!ApiKeyManager.getOpenAIKey()) {
      const keyVal = UIController.getApiKeyInput();
      if (!keyVal || !prompt) {
        alert('Enter both your OpenAI key and a question.');
        return;
      }
      try {
        ApiKeyManager.setOpenAIKey(keyVal);
      } catch (e) {
        alert(e.message);
        return;
      }
      UIController.removeApiKeyInput();
    } else if (!prompt) {
      alert('Enter a question.');
      return;
    }

    // Validate input length
    if (prompt.length > ChatConfig.MAX_INPUT_CHARS) {
      alert(
        `Message too long (${prompt.length.toLocaleString()} chars). ` +
        `Please keep under ${ChatConfig.MAX_INPUT_CHARS.toLocaleString()} characters.`
      );
      return;
    }

    // Check projected token usage
    const projected = ConversationManager.estimateTokens() +
                      Math.ceil(prompt.length / ChatConfig.CHARS_PER_TOKEN);
    if (projected > ChatConfig.MAX_TOTAL_TOKENS) {
      if (!confirm(
        `Estimated tokens (~${projected.toLocaleString()}) exceeds safe limit. ` +
        `Click Clear to reset, or OK to send anyway.`
      )) return;
    }

    isSending = true;
    UIController.setSendingState(true);
    UIController.setLastPrompt(`Last input: ${prompt}`);
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(processing)');
    QuickReplies.hide();

    try {
      ConversationManager.addMessage('user', prompt);
      InputHistory.push(prompt);

      let reply;
      let usage;
      const sendStartTime = performance.now();

      if (ChatConfig.STREAMING_ENABLED) {
        // Streaming path — show tokens as they arrive
        UIController.setChatOutput('');
        const result = await callOpenAIStreaming(
          ApiKeyManager.getOpenAIKey(),
          ConversationManager.getMessages(),
          (token) => UIController.appendChatOutput(token)
        );

        if (!result.ok) { _handleApiError(result); return; }

        reply = result.text || 'No response';
        usage = result.usage;
      } else {
        // Non-streaming path — original behavior
        UIController.setChatOutput('Thinking…');
        const result = await callOpenAI(
          ApiKeyManager.getOpenAIKey(),
          ConversationManager.getMessages()
        );

        if (!result.ok) { _handleApiError(result); return; }

        reply = result.data.choices?.[0]?.message?.content || 'No response';
        usage = result.data.usage;
      }

      const responseTimeMs = Math.round(performance.now() - sendStartTime);
      ConversationManager.addMessage('assistant', reply, { responseTimeMs, timestamp: Date.now() });
      ConversationManager.trim();
      UIController.showTokenUsage(usage);
      CostDashboard.recordUsage(usage);

      // Warn if history is getting large
      if (ConversationManager.estimateTokens() > ChatConfig.TOKEN_WARNING_THRESHOLD) {
        console.warn('[agenticchat] History tokens high — consider clicking Clear');
      }

      // Extract and run code, or display text
      const codeMatch = reply.match(/```(?:js|javascript)?\n([\s\S]*?)```/i);
      if (codeMatch) {
        UIController.displayCode(codeMatch[1]);
        SnippetLibrary.setCurrentCode(codeMatch[1]);
        const sandboxResult = await executeCode(codeMatch[1]);
        QuickReplies.show(reply, true, sandboxResult === false);
      } else {
        UIController.setChatOutput(reply);
        UIController.setConsoleOutput('(no code to run)');
        SnippetLibrary.setCurrentCode(null);
        QuickReplies.show(reply, false, false);
      }

      // Update history panel if open
      HistoryPanel.refresh();

      // Show response time badge
      ResponseTimeBadge.show(responseTimeMs);

      // Auto-save session if enabled
      SessionManager.autoSaveIfEnabled();
    } catch (err) {
      _rollbackLastUserMessage();

      if (err.name === 'AbortError') {
        UIController.setChatOutput('(request cancelled)');
        UIController.setConsoleOutput('(cancelled)');
      } else if (err.name === 'TimeoutError') {
        UIController.setChatOutput('Request timed out — try again.');
        UIController.setConsoleOutput('(timed out)');
      } else {
        UIController.setChatOutput('Network error: ' + err.message);
        UIController.setConsoleOutput('(request failed)');
      }
    } finally {
      isSending = false;
      UIController.setSendingState(false);
      UIController.clearChatInput();
    }
  }

  /** Clear conversation history, bookmarks, snippet state, and reset all UI areas. */
  function clearHistory() {
    ConversationManager.clear();
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt('(history cleared)');
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    try { if (MessageAnnotations && MessageAnnotations.clearAll) MessageAnnotations.clearAll(); } catch (_) {}
    try { if (MessagePinning && MessagePinning.clearAll) MessagePinning.clearAll(); } catch (_) {}
    try { if (ConversationChapters && ConversationChapters.clearAll) ConversationChapters.clearAll(); } catch (_) {}
    HistoryPanel.refresh();
    QuickReplies.hide();
  }

  /** Handle service-key modal submission. */
  async function submitServiceKey() {
    const key = UIController.getServiceKeyInput();
    const code = ApiKeyManager.submitServiceKey(key);
    UIController.hideServiceKeyModal();
    if (code) await runInSandbox(code);
  }

  return { send, clearHistory, submitServiceKey, cancelRequest: abortCurrentRequest };
})();

/* ---------- Prompt Templates ---------- */
/**
 * Categorized prompt template library with search and one-click insertion.
 *
 * Ships with built-in templates across categories (Data & Charts, Web/UI,
 * Utilities, AI/ML, Fun/Creative). Users can search templates by name or
 * description and insert them directly into the chat input. The panel
 * renders as a full-screen modal overlay.
 *
 * @namespace PromptTemplates
 */
const PromptTemplates = (() => {
  let isOpen = false;

  const templates = [
    {
      category: '📊 Data & Charts',
      items: [
        {
          name: 'Bar Chart',
          description: 'Generate a bar chart from sample data',
          prompt: 'Create a bar chart using a canvas element showing monthly sales data for 6 months. Use random realistic values between 10k-50k. Add axis labels, a title, and use a pleasant color palette.'
        },
        {
          name: 'Pie Chart',
          description: 'Create an interactive pie chart',
          prompt: 'Create a pie chart on a canvas showing market share of 5 tech companies. Add labels with percentages, a legend, and hover tooltips that show the exact value.'
        },
        {
          name: 'Data Table',
          description: 'Generate a sortable HTML table',
          prompt: 'Create a styled HTML table with 10 rows of sample employee data (name, department, salary, start date). Make columns sortable by clicking headers. Add zebra striping and hover effects.'
        },
        {
          name: 'Line Graph',
          description: 'Plot a time-series line graph',
          prompt: 'Draw a line graph on a canvas showing temperature data over 24 hours. Use smooth curves, grid lines, axis labels with hours, and mark the min/max points with dots.'
        }
      ]
    },
    {
      category: '🌐 Web & APIs',
      items: [
        {
          name: 'Fetch JSON',
          description: 'Fetch and display JSON from an API',
          prompt: 'Fetch data from https://jsonplaceholder.typicode.com/posts?_limit=5 and display it as styled cards with title, body preview, and post ID. Add a loading spinner while fetching.'
        },
        {
          name: 'Weather Widget',
          description: 'Build a weather display widget',
          prompt: 'Create a weather widget that fetches current weather from https://wttr.in/?format=j1 and displays temperature, condition, humidity, and wind speed with appropriate weather emoji and clean styling.'
        },
        {
          name: 'REST Client',
          description: 'Mini REST API testing tool',
          prompt: 'Build a mini REST client UI with method selector (GET/POST/PUT/DELETE), URL input, request body textarea, and a Send button. Display the response status, headers, and formatted JSON body.'
        }
      ]
    },
    {
      category: '🔧 Utilities',
      items: [
        {
          name: 'Color Palette',
          description: 'Generate and display a color palette',
          prompt: 'Generate a random harmonious color palette of 8 colors. Show each color as a large swatch with its HEX, RGB, and HSL values. Add a click-to-copy feature for the HEX code.'
        },
        {
          name: 'Password Generator',
          description: 'Secure password generator with options',
          prompt: 'Create a password generator with options for length (8-64), uppercase, lowercase, numbers, and symbols. Show the generated password with a strength meter (weak/medium/strong/very strong) and a copy button.'
        },
        {
          name: 'Markdown Preview',
          description: 'Live markdown to HTML converter',
          prompt: 'Build a split-pane markdown editor: textarea on the left, live HTML preview on the right. Support headers, bold, italic, links, code blocks, and lists. Pre-fill with sample markdown content.'
        },
        {
          name: 'Unit Converter',
          description: 'Multi-unit conversion tool',
          prompt: 'Create a unit converter supporting length (m/ft/in/cm), weight (kg/lb/oz), and temperature (°C/°F/K). Auto-convert as the user types. Clean UI with category tabs.'
        }
      ]
    },
    {
      category: '🎨 Fun & Creative',
      items: [
        {
          name: 'Digital Clock',
          description: 'Animated digital clock with themes',
          prompt: 'Create a large digital clock display that updates every second. Show hours, minutes, seconds, and date. Add a dark/light theme toggle. Use a monospace font and smooth transitions.'
        },
        {
          name: 'Drawing Canvas',
          description: 'Simple drawing/sketch pad',
          prompt: 'Build a simple drawing pad with a canvas element. Support mouse drawing, color picker, brush size slider (1-20px), eraser mode, and a clear button. Add an undo feature that remembers the last 10 strokes.'
        },
        {
          name: 'Typing Speed Test',
          description: 'Test your typing speed',
          prompt: 'Create a typing speed test. Show a paragraph of text the user must type. Track WPM, accuracy, and time. Highlight correct characters in green and errors in red. Show results when done.'
        },
        {
          name: 'Particle Effect',
          description: 'Animated particle system',
          prompt: 'Create a canvas-based particle system with 200 colorful particles that follow the mouse cursor. Particles should have gravity, fade out over time, and trail behind the cursor movement.'
        }
      ]
    }
  ];

  function getTemplates() {
    return templates;
  }

  function search(query) {
    if (!query) return templates;
    const q = query.toLowerCase();
    const results = [];
    for (const cat of templates) {
      const matched = cat.items.filter(
        t => t.name.toLowerCase().includes(q) ||
             t.description.toLowerCase().includes(q) ||
             t.prompt.toLowerCase().includes(q)
      );
      if (matched.length > 0) {
        results.push({ category: cat.category, items: matched });
      }
    }
    return results;
  }

  function toggle() {
    isOpen = !isOpen;
    const panel = document.getElementById('templates-panel');
    const overlay = document.getElementById('templates-overlay');
    if (isOpen) {
      panel.classList.add('open');
      overlay.classList.add('visible');
      render(templates);
      const searchInput = document.getElementById('templates-search');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
    } else {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function close() {
    isOpen = false;
    const panel = document.getElementById('templates-panel');
    const overlay = document.getElementById('templates-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  function render(data) {
    const container = document.getElementById('templates-list');
    if (!container) return;

    if (data.length === 0) {
      container.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'templates-empty';
      empty.textContent = 'No templates match your search.';
      container.appendChild(empty);
      return;
    }

    // Build all template nodes in a DocumentFragment to avoid
    // repeated reflows from per-category appendChild calls.
    const fragment = document.createDocumentFragment();

    data.forEach(cat => {
      const catEl = document.createElement('div');
      catEl.className = 'template-category';

      const catTitle = document.createElement('div');
      catTitle.className = 'template-category-title';
      catTitle.textContent = cat.category;
      catEl.appendChild(catTitle);

      cat.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        const name = document.createElement('div');
        name.className = 'template-name';
        name.textContent = item.name;
        card.appendChild(name);

        const desc = document.createElement('div');
        desc.className = 'template-desc';
        desc.textContent = item.description;
        card.appendChild(desc);

        card.addEventListener('click', () => selectTemplate(item));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectTemplate(item);
          }
        });

        catEl.appendChild(card);
      });

      fragment.appendChild(catEl);
    });

    // Single DOM mutation: clear and append all categories at once
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  function selectTemplate(item) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = item.prompt;
      input.focus();
      UIController.updateCharCount(item.prompt.length);
    }
    close();
  }

  function handleSearch() {
    const searchInput = document.getElementById('templates-search');
    if (!searchInput) return;
    const query = searchInput.value.trim();
    const results = search(query);
    render(results);
  }

  // Debounced version: waits 150ms after last keystroke before searching.
  // Prevents unnecessary array allocations and DOM rebuilds on every keypress.
  let _searchTimer = null;
  function handleSearchDebounced() {
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      _searchTimer = null;
      handleSearch();
    }, 150);
  }

  return { getTemplates, search, toggle, close, render, handleSearch, handleSearchDebounced, selectTemplate };
})();

/* ---------- History Panel ---------- */
/**
 * Slide-out conversation history panel with export/import capabilities.
 *
 * Displays timestamped conversation entries with relative-time labels,
 * supports exporting the full history as Markdown or JSON, and allows
 * importing previously exported conversations. The panel slides in from
 * the right with an overlay backdrop.
 *
 * @namespace HistoryPanel
 */
const HistoryPanel = (() => {
  let isOpen = false;

  const _cache = {};
  function el(id) {
    let node = _cache[id];
    if (!node) {
      node = document.getElementById(id);
      if (node) _cache[id] = node;
    }
    return node;
  }

  /** File-safe ISO timestamp (colons/dots → dashes, trimmed to seconds). */
  function _fileTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function toggle() {
    isOpen = !isOpen;
    const panel = el('history-panel');
    const overlay = el('history-overlay');
    if (isOpen) {
      panel.classList.add('open');
      overlay.classList.add('visible');
      refresh();
    } else {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function close() {
    isOpen = false;
    el('history-panel').classList.remove('open');
    el('history-overlay').classList.remove('visible');
  }

  /**
   * Rebuild the history panel DOM.
   * Uses DocumentFragment for batch DOM insertion (single reflow/repaint).
   */
  /**
   * Render message content into a container element, splitting code
   * blocks (```...```) into <pre> elements and surrounding text into
   * <div class="msg-text"> elements.
   *
   * Handles multiple code blocks per message (not just the first).
   *
   * @param {HTMLElement} container  The element to append content to.
   * @param {string}      content    Raw message text.
   */
  function _renderContent(container, content) {
    // Split on fenced code blocks: ```[lang]\n...\n```
    var codeBlockRegex = /```(?:\w*)\n([\s\S]*?)```/g;
    var lastIndex = 0;
    var match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Text before this code block
      var before = content.substring(lastIndex, match.index).trim();
      if (before) {
        var textEl = document.createElement('div');
        textEl.className = 'msg-text';
        textEl.textContent = before;
        container.appendChild(textEl);
      }

      // The code block itself
      var pre = document.createElement('pre');
      pre.textContent = match[1];
      container.appendChild(pre);

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last code block (or entire content if no blocks)
    var remaining = content.substring(lastIndex).trim();
    if (remaining) {
      var textEl2 = document.createElement('div');
      textEl2.className = 'msg-text';
      textEl2.textContent = remaining;
      container.appendChild(textEl2);
    }
  }

  function refresh() {
    const container = el('history-messages');
    const history = ConversationManager.getHistory();

    // Filter out system messages — iterate directly instead of
    // creating a filtered copy via getMessages() + filter().
    const messages = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].role !== 'system') messages.push(history[i]);
    }

    if (messages.length === 0) {
      container.innerHTML = '<div class="history-empty">No messages yet.<br>Start a conversation to see history here.</div>';
      return;
    }

    // Build all nodes in a DocumentFragment (off-DOM) to trigger
    // only a single reflow when appended, instead of one per message.
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const div = document.createElement('div');
      div.className = `history-msg ${msg.role}`;

      const roleLabel = document.createElement('div');
      roleLabel.className = 'msg-role';
      const roleText = msg.role === 'user' ? '👤 You' : '🤖 Assistant';
      if (msg.role === 'assistant' && msg.responseTimeMs !== undefined && ConversationManager.isTimingVisible()) {
        roleLabel.innerHTML = `${roleText} <span class="msg-timing">⏱️ ${ResponseTimeBadge.formatTime(msg.responseTimeMs)}</span>`;
      } else {
        roleLabel.textContent = roleText;
      }
      div.appendChild(roleLabel);

      // Render message content — handles multiple code blocks
      _renderContent(div, msg.content);

      fragment.appendChild(div);
    }

    // Single DOM mutation: clear + append fragment
    container.textContent = '';
    container.appendChild(fragment);

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Decorate messages — single DOM traversal instead of 5 separate passes.
    // See issue #40: each decorateMessages() was doing its own querySelectorAll,
    // causing 5×N DOM traversals. Now we query once and dispatch per-message.
    _decorateAllMessages(container);
  }

  /**
   * Unified single-pass message decoration. Queries the DOM once and calls
   * each decorator's per-message function in a single loop.
   *
   * Before this fix, 5 separate decorateMessages() calls each did:
   *   container.querySelectorAll('.history-msg')  → full DOM traversal
   *   iterate all N messages
   * Total: 5 × N DOM reads + element creates.
   *
   * Now: 1 querySelectorAll + 1 iteration through N messages.
   * Complexity: O(N) instead of O(5N) with 5× fewer DOM queries.
   */
  function _decorateAllMessages(container) {
    if (!container) return;
    var msgs = container.querySelectorAll('.history-msg');
    if (msgs.length === 0) return;

    var history = ConversationManager.getHistory();
    var nonSystemIdx = 0;

    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (nonSystemIdx >= msgs.length) break;

      var msgEl = msgs[nonSystemIdx];
      var role = history[i].role;

      // MessageReactions: all messages
      MessageReactions.decorateOne(msgEl, i);

      // ConversationFork: all messages
      ConversationFork.decorateOne(msgEl, i);

      // ReadAloud: assistant messages only
      if (role === 'assistant') {
        ReadAloud.decorateOne(msgEl, i);
      }

      // ResponseRating: assistant messages only
      if (role === 'assistant') {
        ResponseRating.decorateOne(msgEl, nonSystemIdx);
      }

      // MessageTranslator: all messages
      MessageTranslator.decorateOne(msgEl, nonSystemIdx);

      // MessageEditor: user messages only (decorateOne checks role internally)
      MessageEditor.decorateOne(msgEl, i);

      nonSystemIdx++;
    }
  }

  function exportAsMarkdown() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = _fileTimestamp();
    // Build via array.join — repeated string += is O(n²) in total
    // content length because JS strings are immutable (each += copies).
    const parts = [`# Agentic Chat Export\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`];

    messages.forEach((msg) => {
      const role = msg.role === 'user' ? '👤 **You**' : '🤖 **Assistant**';
      parts.push(`### ${role}\n\n${msg.content}\n\n---\n\n`);
    });

    downloadBlob(`agenticchat-${timestamp}.md`, parts.join(''), 'text/markdown');
  }

  function exportAsJSON() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = _fileTimestamp();
    const data = {
      exported: new Date().toISOString(),
      model: ChatConfig.MODEL,
      messageCount: messages.length,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    };

    downloadBlob(`agenticchat-${timestamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function exportAsHTML() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = _fileTimestamp();
    const dateStr = new Date().toLocaleString();

    const escapeHTML = _escapeHtml;

    function renderMessageHTML(msg) {
      const isUser = msg.role === 'user';
      const roleLabel = isUser ? '👤 You' : '🤖 Assistant';
      const bgColor = isUser ? '#1e3a5f' : '#1a2e1a';
      const borderColor = isUser ? '#38bdf8' : '#4ade80';

      // Check for code blocks
      const codeMatch = msg.content.match(/```(?:js|javascript)?\n([\s\S]*?)```/i);
      let bodyHTML;
      if (codeMatch) {
        const before = escapeHTML(msg.content.substring(0, msg.content.indexOf('```')).trim());
        const code = escapeHTML(codeMatch[1]);
        const afterIdx = msg.content.indexOf('```', msg.content.indexOf('```') + 3);
        const after = afterIdx >= 0 ? escapeHTML(msg.content.substring(afterIdx + 3).trim()) : '';
        bodyHTML =
          (before ? `<div style="white-space:pre-wrap;margin-bottom:8px">${before}</div>` : '') +
          `<pre style="background:#0d0d0d;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.4">${code}</pre>` +
          (after ? `<div style="white-space:pre-wrap;margin-top:8px">${after}</div>` : '');
      } else {
        bodyHTML = `<div style="white-space:pre-wrap">${escapeHTML(msg.content)}</div>`;
      }

      const timingHTML = (!isUser && msg.responseTimeMs !== undefined)
        ? ` <span style="font-size:11px;opacity:0.6">⏱️ ${ResponseTimeBadge.formatTime(msg.responseTimeMs)}</span>`
        : '';

      return `<div style="background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;padding:12px 16px;margin-bottom:12px;word-break:break-word">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;margin-bottom:6px">${roleLabel}${timingHTML}</div>
  ${bodyHTML}
</div>`;
    }

    const messagesHTML = messages.map(renderMessageHTML).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Chat Export — ${escapeHTML(dateStr)}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#111;color:#eee;margin:0;padding:0}
.container{max-width:720px;margin:0 auto;padding:24px 16px}
h1{font-size:1.4rem;text-align:center;margin:0 0 4px}
.meta{text-align:center;color:#888;font-size:0.82rem;margin-bottom:24px}
.meta span{margin:0 8px}
pre{margin:0}
code{font-family:ui-monospace,'Cascadia Code','Fira Code',monospace}
@media(prefers-color-scheme:light){
  body{background:#f5f5f5;color:#1a1a1a}
  .meta{color:#666}
}
</style>
</head>
<body>
<div class="container">
<h1>Agentic Chat</h1>
<div class="meta">
  <span>📅 ${escapeHTML(dateStr)}</span>
  <span>🤖 ${escapeHTML(ChatConfig.MODEL)}</span>
  <span>💬 ${messages.length} message${messages.length !== 1 ? 's' : ''}</span>
</div>
${messagesHTML}
</div>
</body>
</html>`;

    downloadBlob(`agenticchat-${timestamp}.html`, html, 'text/html');
  }

  function exportAsCSV() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = _fileTimestamp();

    function csvEscape(str) {
      // Defend against CSV injection (DDE/formula injection): if the cell
      // value starts with =, +, -, @, tab, or carriage return, a spreadsheet
      // app (Excel, Google Sheets, LibreOffice) may interpret it as a
      // formula.  Prefix with a single-quote to force text mode.
      // Reference: OWASP CSV Injection cheat sheet.
      var s = String(str);
      if (/^[=+\-@\t\r]/.test(s)) {
        s = "'" + s;
      }
      if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    let csv = 'Role,Message,Timestamp,Response Time (ms)\n';
    messages.forEach((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : '';
      const rt = msg.responseTimeMs !== undefined ? msg.responseTimeMs : '';
      csv += `${csvEscape(role)},${csvEscape(msg.content)},${csvEscape(ts)},${csvEscape(String(rt))}\n`;
    });

    downloadBlob(`agenticchat-${timestamp}.csv`, csv, 'text/csv');
  }

  return { toggle, close, refresh, exportAsMarkdown, exportAsJSON, exportAsHTML, exportAsCSV };
})();

/* ---------- Snippet Library ---------- */
/**
 * Persistent code snippet library with tagging, search, and categories.
 *
 * Saves user-curated code snippets to localStorage with metadata (name,
 * tags, language, category, creation/update timestamps). Supports search
 * by name/tag, filtering by language, import/export as JSON, and
 * one-click insertion of snippets back into the chat. Includes an "auto-save
 * last output" option for capturing sandbox results. Maximum 100 snippets,
 * 50 KB per snippet.
 *
 * @namespace SnippetLibrary
 */
const SnippetLibrary = (() => {
  const STORAGE_KEY = 'agenticchat_snippets';
  let isOpen = false;
  let currentCode = null;  // code displayed in chat-output for save

  const _cache = {};
  function el(id) {
    let node = _cache[id];
    if (!node) {
      node = document.getElementById(id);
      if (node) _cache[id] = node;
    }
    return node;
  }
  let _searchTimer = null;

  /** Load snippets from localStorage. */
  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      return raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch { return []; }
  }

  /** Save snippets to localStorage. Returns true on success, false on failure. */
  function save(snippets) {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(snippets));
      return true;
    } catch (e) {
      console.error('[SnippetLibrary] Failed to persist snippets:', e.message);
      return false;
    }
  }

  function getAll() { return load(); }

  function getCount() { return load().length; }

  /** Add a new snippet. Returns {snippets, saved} where saved indicates persistence. */
  function add(name, code, tags) {
    const MAX_SNIPPET_NAME = 200;
    const MAX_SNIPPET_CODE = 500000; // 500 KB
    const MAX_SNIPPETS = 200;

    let snippets = load();

    // Prevent unbounded growth
    if (snippets.length >= MAX_SNIPPETS) {
      return { snippets: snippets, saved: false };
    }

    snippets.unshift({
      id: crypto.randomUUID(),
      name: name.trim().substring(0, MAX_SNIPPET_NAME),
      code: (code || '').substring(0, MAX_SNIPPET_CODE),
      tags: tags.map(t => t.trim()).filter(t => t.length > 0).slice(0, 20),
      createdAt: new Date().toISOString()
    });
    const saved = save(snippets);
    return { snippets, saved };
  }

  /** Delete a snippet by ID. Returns {snippets, saved}. */
  function remove(id) {
    const snippets = load().filter(s => s.id !== id);
    const saved = save(snippets);
    return { snippets, saved };
  }

  /** Rename a snippet. Returns {snippets, saved}. */
  function rename(id, newName) {
    const snippets = load();
    const snippet = snippets.find(s => s.id === id);
    if (snippet) snippet.name = newName.trim();
    const saved = save(snippets);
    return { snippets, saved };
  }

  /** Clear all snippets. Returns {saved}. */
  function clearAll() {
    const saved = save([]);
    return { saved };
  }

  /** Search snippets by name, tags, or code content. */
  function search(query) {
    if (!query) return load();
    const q = query.toLowerCase();
    return load().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /** Set current code (called when AI generates code). */
  function setCurrentCode(code) {
    currentCode = code;
    const actionsEl = el('code-actions');
    if (actionsEl) actionsEl.style.display = code ? 'flex' : 'none';
  }

  function getCurrentCode() { return currentCode; }

  /** Open save dialog for current code. */
  function openSaveDialog() {
    if (!currentCode) return;
    const modal = el('snippet-save-modal');
    const nameInput = el('snippet-name-input');
    const tagsInput = el('snippet-tags-input');
    const preview = el('snippet-code-preview');

    nameInput.value = '';
    tagsInput.value = '';

    // Show first 5 lines of code as preview
    const lines = currentCode.split('\n');
    const previewText = lines.slice(0, 5).join('\n') +
      (lines.length > 5 ? `\n… (${lines.length - 5} more lines)` : '');
    preview.textContent = previewText;

    modal.style.display = 'flex';
    nameInput.focus();
  }

  /** Confirm save from dialog. */
  function confirmSave() {
    const nameInput = el('snippet-name-input');
    const tagsInput = el('snippet-tags-input');

    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (!currentCode) return;

    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    const result = add(name, currentCode, tags);
    closeSaveDialog();

    // Show confirmation or error feedback
    const saveBtn = el('save-snippet-btn');
    if (saveBtn) {
      if (result.saved) {
        saveBtn.textContent = '✅ Saved!';
      } else {
        saveBtn.textContent = '❌ Storage full!';
      }
      setTimeout(() => { saveBtn.textContent = '💾 Save Snippet'; }, 2000);
    }

    // Refresh snippets panel if open
    if (isOpen) refresh();
  }

  function closeSaveDialog() {
    const modal = el('snippet-save-modal');
    if (modal) modal.style.display = 'none';
  }

  /** Copy current code to clipboard. */
  function copyCurrentCode() {
    if (!currentCode) return;
    navigator.clipboard.writeText(currentCode).then(() => {
      const btn = el('copy-code-btn');
      if (btn) {
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
      }
    }).catch(() => {});
  }

  /** Re-run current code in sandbox. */
  async function rerunCurrentCode() {
    if (!currentCode || SandboxRunner.isRunning()) return;
    const substituted = ApiKeyManager.substituteServiceKey(currentCode);
    if (substituted === null) {
      UIController.showServiceKeyModal(ApiKeyManager.getPendingDomain());
      return;
    }
    UIController.setConsoleOutput('(running in sandbox…)');
    UIController.setSandboxRunning(true);
    const result = await SandboxRunner.run(substituted);
    UIController.setConsoleOutput(result.value, result.ok ? '#4ade80' : '#f87171');
    UIController.resetSandboxUI();
  }

  /** Toggle snippets panel. */
  function toggle() {
    isOpen = !isOpen;
    const panel = el('snippets-panel');
    const overlay = el('snippets-overlay');
    if (isOpen) {
      panel.classList.add('open');
      overlay.classList.add('visible');
      const searchInput = el('snippets-search');
      if (searchInput) { searchInput.value = ''; searchInput.focus(); }
      refresh();
    } else {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function close() {
    isOpen = false;
    const panel = el('snippets-panel');
    const overlay = el('snippets-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  /** Render snippets list. */
  function refresh() {
    const searchInput = el('snippets-search');
    const query = searchInput ? searchInput.value.trim() : '';
    const snippets = search(query);
    render(snippets);
  }

  function render(snippets) {
    const container = el('snippets-list');
    const countEl = el('snippets-count');
    if (!container) return;

    const total = getCount();
    if (countEl) {
      countEl.textContent = total === 0 ? '' :
        `${snippets.length}${snippets.length !== total ? ' of ' + total : ''} snippet${total !== 1 ? 's' : ''}`;
    }

    if (snippets.length === 0) {
      container.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'snippets-empty';
      empty.textContent = total === 0
        ? 'No saved snippets yet.\nGenerate code, then click 💾 Save Snippet.'
        : 'No snippets match your search.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    snippets.forEach(snippet => {
      const card = document.createElement('div');
      card.className = 'snippet-card';
      card.dataset.id = snippet.id;

      // Header row: name + time
      const header = document.createElement('div');
      header.className = 'snippet-card-header';

      const nameEl = document.createElement('span');
      nameEl.className = 'snippet-name';
      nameEl.textContent = snippet.name;
      nameEl.title = 'Double-click to rename';
      nameEl.addEventListener('dblclick', () => startRename(snippet.id, nameEl));
      header.appendChild(nameEl);

      const timeEl = document.createElement('span');
      timeEl.className = 'snippet-time';
      timeEl.textContent = formatRelativeTime(snippet.createdAt);
      timeEl.title = new Date(snippet.createdAt).toLocaleString();
      header.appendChild(timeEl);
      card.appendChild(header);

      // Tags
      if (snippet.tags && snippet.tags.length > 0) {
        const tagsEl = document.createElement('div');
        tagsEl.className = 'snippet-tags';
        snippet.tags.forEach(tag => {
          const tagSpan = document.createElement('span');
          tagSpan.className = 'snippet-tag';
          tagSpan.textContent = tag;
          tagsEl.appendChild(tagSpan);
        });
        card.appendChild(tagsEl);
      }

      // Code preview (first 3 lines)
      const codePreview = document.createElement('pre');
      codePreview.className = 'snippet-code-preview';
      const lines = snippet.code.split('\n');
      codePreview.textContent = lines.slice(0, 3).join('\n') +
        (lines.length > 3 ? '\n…' : '');
      card.appendChild(codePreview);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'snippet-card-actions';

      const useBtn = document.createElement('button');
      useBtn.className = 'btn-sm';
      useBtn.textContent = '▶️ Run';
      useBtn.title = 'Load and run this snippet';
      useBtn.addEventListener('click', () => useSnippet(snippet));
      actions.appendChild(useBtn);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-sm';
      copyBtn.textContent = '📋 Copy';
      copyBtn.title = 'Copy code to clipboard';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(snippet.code).then(() => {
          copyBtn.textContent = '✅';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1000);
        }).catch(() => {});
      });
      actions.appendChild(copyBtn);

      const insertBtn = document.createElement('button');
      insertBtn.className = 'btn-sm';
      insertBtn.textContent = '📝 Insert';
      insertBtn.title = 'Insert code into chat input';
      insertBtn.addEventListener('click', () => {
        const input = el('chat-input');
        if (input) {
          input.value = 'Run this code:\n```js\n' + snippet.code + '\n```';
          input.focus();
          UIController.updateCharCount(input.value.length);
        }
        close();
      });
      actions.appendChild(insertBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-sm btn-danger-sm';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Delete snippet';
      deleteBtn.addEventListener('click', () => {
        const result = remove(snippet.id);
        if (!result.saved) {
          alert('Failed to delete snippet — storage may be unavailable.');
        }
        refresh();
      });
      actions.appendChild(deleteBtn);

      card.appendChild(actions);
      fragment.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /** Inline rename on double-click. */
  function startRename(id, nameEl) {
    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'snippet-rename-input';
    input.value = currentName;

    function finishRename() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        rename(id, newName);
      }
      refresh();
    }

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }

  /** Load snippet into chat output and run it. */
  async function useSnippet(snippet) {
    close();
    UIController.displayCode(snippet.code);
    setCurrentCode(snippet.code);

    const substituted = ApiKeyManager.substituteServiceKey(snippet.code);
    if (substituted === null) {
      UIController.showServiceKeyModal(ApiKeyManager.getPendingDomain());
      return;
    }
    UIController.setConsoleOutput('(running in sandbox…)');
    UIController.setSandboxRunning(true);
    const result = await SandboxRunner.run(substituted);
    UIController.setConsoleOutput(result.value, result.ok ? '#4ade80' : '#f87171');
    UIController.resetSandboxUI();
  }

  function handleSearchDebounced() {
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      _searchTimer = null;
      refresh();
    }, 150);
  }

  function handleClearAll() {
    const count = getCount();
    if (count === 0) return;
    if (!confirm(`Delete all ${count} saved snippet${count !== 1 ? 's' : ''}?`)) return;
    const result = clearAll();
    if (!result.saved) {
      alert('Failed to clear snippets — storage may be unavailable.');
    }
    refresh();
  }

  return {
    getAll, getCount, add, remove, rename, clearAll, search,
    setCurrentCode, getCurrentCode,
    openSaveDialog, confirmSave, closeSaveDialog,
    copyCurrentCode, rerunCurrentCode,
    toggle, close, refresh, render,
    formatRelativeTime, handleSearchDebounced, handleClearAll,
    load, save  // exposed for testing
  };
})();

/* ---------- Message Search ---------- */
/**
 * Full-text search across conversation messages with match navigation.
 *
 * Debounced search (200 ms) highlights matching messages in the chat output,
 * supports next/previous navigation with `Enter`/`Shift+Enter`, and shows a
 * match counter. Triggered via `Ctrl+F` / `Cmd+F` when not in an input field.
 * Case-insensitive matching with regex-safe escaping.
 *
 * @namespace MessageSearch
 */
const MessageSearch = (() => {
  let isOpen = false;
  let matches = [];
  let currentIndex = -1;
  let previousIndex = -1;
  let debounceTimer = null;
  let lastQuery = '';
  const DEBOUNCE_MS = 200;

  /**
   * Open the search bar and focus the input.
   */
  function open() {
    const bar = document.getElementById('search-bar');
    if (!bar) return;
    bar.style.display = 'flex';
    isOpen = true;
    const input = document.getElementById('search-input');
    if (input) {
      input.focus();
      // Re-search if there's existing text
      if (input.value.trim()) performSearch(input.value.trim());
    }
  }

  /**
   * Close the search bar and clear highlights.
   */
  function close() {
    const bar = document.getElementById('search-bar');
    if (!bar) return;
    bar.style.display = 'none';
    isOpen = false;
    clearHighlights();
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    updateCount();
  }

  /**
   * Toggle search bar visibility.
   */
  function toggle() {
    if (isOpen) close();
    else open();
  }

  /**
   * Perform a case-insensitive search through chat messages.
   * Highlights all matches with <mark> elements.
   * @param {string} query  Search string.
   */
  function performSearch(query) {
    clearHighlights();
    lastQuery = query || '';

    if (!query || query.length === 0) {
      updateCount();
      return;
    }

    const output = document.getElementById('chat-output');
    if (!output) return;

    const messageDivs = output.querySelectorAll('.chat-msg, .code-block, [class*="msg"]');
    // If no structured messages, search all child elements
    const targets = messageDivs.length > 0
      ? messageDivs
      : output.children;

    matches = [];
    const lowerQuery = query.toLowerCase();

    for (let i = 0; i < targets.length; i++) {
      highlightTextNodes(targets[i], lowerQuery);
    }

    // Collect all marks
    matches = Array.from(output.querySelectorAll('mark.search-highlight'));
    currentIndex = matches.length > 0 ? 0 : -1;

    updateCount();
    updateNavButtons();

    if (currentIndex >= 0) {
      scrollToCurrent();
    }
  }

  /**
   * Recursively walk text nodes and wrap matches in <mark>.
   * @param {Node} node       Element to search within.
   * @param {string} query    Lowercase search string.
   */
  function highlightTextNodes(node, query) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(query);

      if (idx === -1) return;

      const parent = node.parentNode;
      if (!parent) return;

      // Split the text node at the match boundaries
      const before = text.substring(0, idx);
      const match = text.substring(idx, idx + query.length);
      const after = text.substring(idx + query.length);

      const frag = document.createDocumentFragment();

      if (before) frag.appendChild(document.createTextNode(before));

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = match;
      frag.appendChild(mark);

      if (after) {
        const afterNode = document.createTextNode(after);
        frag.appendChild(afterNode);
        parent.replaceChild(frag, node);
        // Continue searching in the remaining text
        highlightTextNodes(afterNode, query);
      } else {
        parent.replaceChild(frag, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Skip already-highlighted marks and script/style
      if (node.tagName === 'MARK' && node.classList.contains('search-highlight')) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;

      // Snapshot child nodes (live NodeList mutates during highlighting)
      const children = Array.from(node.childNodes);
      for (let i = 0; i < children.length; i++) {
        highlightTextNodes(children[i], query);
      }
    }
  }

  /**
   * Remove all <mark> highlights and restore original text nodes.
   */
  function clearHighlights() {
    const output = document.getElementById('chat-output');
    if (!output) return;

    const marks = output.querySelectorAll('mark.search-highlight');
    const parentsToNormalize = new Set();
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      const parent = mark.parentNode;
      if (!parent) continue;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parentsToNormalize.add(parent);
    }
    // Normalize once per unique parent instead of once per mark
    parentsToNormalize.forEach(parent => parent.normalize());

    matches = [];
    currentIndex = -1;
    previousIndex = -1;
    updateNavButtons();
  }

  /**
   * Navigate to the next match.
   */
  function next() {
    if (matches.length === 0) return;
    currentIndex = (currentIndex + 1) % matches.length;
    scrollToCurrent();
    updateCount();
  }

  /**
   * Navigate to the previous match.
   */
  function prev() {
    if (matches.length === 0) return;
    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
    scrollToCurrent();
    updateCount();
  }

  /**
   * Scroll the current match into view and highlight it.
   */
  function scrollToCurrent() {
    // Remove current indicator from the previous mark only (O(1) vs O(n))
    if (previousIndex >= 0 && previousIndex < matches.length) {
      matches[previousIndex].classList.remove('search-current');
    }

    if (currentIndex >= 0 && currentIndex < matches.length) {
      matches[currentIndex].classList.add('search-current');
      if (typeof matches[currentIndex].scrollIntoView === 'function') {
        matches[currentIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
    previousIndex = currentIndex;
  }

  /**
   * Update the match count display.
   */
  function updateCount() {
    const countEl = document.getElementById('search-count');
    if (!countEl) return;

    if (matches.length === 0) {
      countEl.textContent = lastQuery ? 'No results' : '';
    } else {
      countEl.textContent = `${currentIndex + 1} of ${matches.length}`;
    }
  }

  /**
   * Enable/disable nav buttons based on match count.
   */
  function updateNavButtons() {
    const prevBtn = document.getElementById('search-prev');
    const nextBtn = document.getElementById('search-next');
    if (prevBtn) prevBtn.disabled = matches.length === 0;
    if (nextBtn) nextBtn.disabled = matches.length === 0;
  }

  /**
   * Debounced search input handler.
   */
  function handleInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const input = document.getElementById('search-input');
      if (input) performSearch(input.value.trim());
    }, DEBOUNCE_MS);
  }

  /**
   * Handle keydown in the search input.
   * Enter = next match, Shift+Enter = prev match, Escape = close.
   */
  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  /**
   * Return search state for testing.
   */
  function getState() {
    return {
      isOpen,
      matchCount: matches.length,
      currentIndex,
      matches: matches.slice()
    };
  }

  return {
    open,
    close,
    toggle,
    performSearch,
    clearHighlights,
    next,
    prev,
    getState,
    handleInput,
    handleKeydown,
    isSearchOpen: () => isOpen
  };
})();

/* ---------- Chat Bookmarks ---------- */
/**
 * Bookmark individual messages for quick reference and recall.
 *
 * Persists bookmarks to localStorage, each storing the message's DOM index,
 * role, text preview, optional user note, and timestamp. Supports up to
 * {@link MAX_BOOKMARKS} (50) bookmarks. The bookmarks panel lists entries
 * with click-to-scroll navigation and inline note editing.
 *
 * **Caveat:** Bookmarks reference messages by DOM index, which is invalidated
 * when the conversation is cleared or a different session is loaded. Bookmarks
 * are cleared automatically on those transitions.
 *
 * @namespace ChatBookmarks
 */
const ChatBookmarks = (() => {
  const STORAGE_KEY = 'chatBookmarks';
  const MAX_BOOKMARKS = 50;

  let bookmarks = [];
  let panelOpen = false;

  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (!raw) { bookmarks = []; return; }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { bookmarks = []; return; }
      bookmarks = sanitizeStorageObject(parsed);
    } catch (_) {
      bookmarks = [];
    }
  }

  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(bookmarks));
    } catch (_) { /* storage full */ }
  }

  function add(messageIndex, role, fullText) {
    if (isBookmarked(messageIndex)) return null;
    if (bookmarks.length >= MAX_BOOKMARKS) return null;
    const preview = (fullText || '').substring(0, 100).trim();
    const bookmark = {
      id: Date.now() + '-' + messageIndex,
      messageIndex,
      preview,
      role,
      timestamp: new Date().toISOString()
    };
    bookmarks.push(bookmark);
    save();
    return bookmark;
  }

  function remove(id) {
    const before = bookmarks.length;
    bookmarks = bookmarks.filter(b => b.id !== id);
    if (bookmarks.length !== before) save();
  }

  function isBookmarked(messageIndex) {
    return bookmarks.some(b => b.messageIndex === messageIndex);
  }

  function toggle(messageIndex, role, fullText) {
    const existing = bookmarks.find(b => b.messageIndex === messageIndex);
    if (existing) {
      remove(existing.id);
      return false;
    } else {
      add(messageIndex, role, fullText);
      return true;
    }
  }

  function getAll() {
    return [...bookmarks].sort((a, b) => a.messageIndex - b.messageIndex);
  }

  function getCount() {
    return bookmarks.length;
  }

  function clearAll() {
    bookmarks = [];
    save();
  }

  function jumpTo(messageIndex) {
    const output = document.getElementById('chat-output');
    if (!output) return;
    const msgs = output.querySelectorAll('.chat-msg');
    if (messageIndex >= 0 && messageIndex < msgs.length) {
      msgs[messageIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function decorateMessages() {
    const output = document.getElementById('chat-output');
    if (!output) return;
    const msgs = output.querySelectorAll('.chat-msg');
    msgs.forEach((msg, idx) => {
      // Remove existing indicator if any
      const existing = msg.querySelector('.bookmark-indicator');
      if (existing) existing.remove();

      const indicator = document.createElement('span');
      indicator.className = 'bookmark-indicator';
      indicator.title = 'Toggle bookmark';
      indicator.textContent = isBookmarked(idx) ? '⭐' : '☆';
      indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        const role = msg.classList.contains('user') ? 'user' : 'assistant';
        toggle(idx, role, msg.textContent);
        decorateMessages();
        if (panelOpen) renderPanel();
      });

      if (isBookmarked(idx)) {
        msg.style.borderLeft = '3px solid gold';
      } else {
        msg.style.borderLeft = '';
      }

      msg.appendChild(indicator);
    });
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    panelOpen = true;
    const panel = document.getElementById('bookmarks-panel');
    if (panel) panel.style.display = '';
    renderPanel();
  }

  function closePanel() {
    panelOpen = false;
    const panel = document.getElementById('bookmarks-panel');
    if (panel) panel.style.display = 'none';
  }

  function renderPanel() {
    const list = document.getElementById('bookmarks-list');
    if (!list) return;
    list.innerHTML = '';

    const sorted = getAll();
    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookmarks-empty';
      empty.textContent = 'No bookmarks yet. Click ☆ on a message to bookmark it.';
      list.appendChild(empty);
      return;
    }

    sorted.forEach(bm => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';

      const roleBadge = document.createElement('span');
      roleBadge.className = 'bookmark-role';
      roleBadge.textContent = bm.role === 'user' ? '👤' : '🤖';

      const preview = document.createElement('span');
      preview.className = 'bookmark-preview';
      preview.textContent = bm.preview;

      const time = document.createElement('span');
      time.className = 'bookmark-time';
      time.textContent = new Date(bm.timestamp).toLocaleTimeString();

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'bookmark-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Remove bookmark';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove(bm.id);
        renderPanel();
        decorateMessages();
      });

      item.appendChild(roleBadge);
      item.appendChild(preview);
      item.appendChild(time);
      item.appendChild(deleteBtn);

      item.addEventListener('click', () => {
        jumpTo(bm.messageIndex);
      });

      list.appendChild(item);
    });
  }

  // Load on init
  load();

  return {
    load, save, add, remove, isBookmarked, toggle,
    getAll, getCount, clearAll, jumpTo,
    decorateMessages, togglePanel, openPanel, closePanel, renderPanel,
    _getState: () => ({ bookmarks: [...bookmarks], panelOpen }),
    MAX_BOOKMARKS
  };
})();

/* ---------- Slash Commands ---------- */
/**
 * Slash-command autocomplete dropdown for quick actions.
 *
 * Activated by typing `/` at the start of the chat input. Presents a
 * filterable dropdown of available commands (clear, export, templates,
 * snippets, theme, voice, etc.) with keyboard navigation (↑/↓/Enter/Esc)
 * and mouse click support. Shows up to {@link MAX_VISIBLE} (8) items at a
 * time with fuzzy name matching.
 *
 * @namespace SlashCommands
 */
const SlashCommands = (() => {
    let isOpen = false;
    let selectedIndex = -1;
    let filteredCommands = [];
    let dropdownEl = null;

    const MAX_VISIBLE = 8;

    const commands = Object.freeze([
        { name: 'clear', description: 'Clear conversation history', icon: '🗑️',
          action: () => ChatController.clearHistory() },
        { name: 'export', description: 'Export chat as Markdown', icon: '📤',
          action: () => HistoryPanel.exportAsMarkdown() },
        { name: 'export-html', description: 'Export chat as styled HTML page', icon: '🌐',
          action: () => HistoryPanel.exportAsHTML() },
        { name: 'export-csv', description: 'Export chat as CSV spreadsheet', icon: '📊',
          action: () => HistoryPanel.exportAsCSV() },
        { name: 'history', description: 'Toggle history panel', icon: '📜',
          action: () => HistoryPanel.toggle() },
        { name: 'templates', description: 'Open prompt templates', icon: '📋',
          action: () => PromptTemplates.toggle() },
        { name: 'snippets', description: 'Open code snippets', icon: '💾',
          action: () => SnippetLibrary.toggle() },
        { name: 'theme', description: 'Toggle dark/light theme', icon: '🎨',
          action: () => ThemeManager.toggle() },
        { name: 'search', description: 'Open message search', icon: '🔍',
          action: () => MessageSearch.toggle() },
        { name: 'bookmarks', description: 'Toggle bookmarks panel', icon: '🔖',
          action: () => ChatBookmarks.togglePanel() },
        { name: 'shortcuts', description: 'Show keyboard shortcuts', icon: '⌨️',
          action: () => KeyboardShortcuts.showHelp() },
        { name: 'voice', description: 'Toggle voice input', icon: '🎤',
          action: () => VoiceInput.toggle() },
        { name: 'reactions', description: 'Refresh emoji reaction buttons on messages', icon: '😀',
          action: () => { MessageReactions.decorateMessages(); UIController.setChatOutput('Reactions refreshed on all messages.'); } },
        { name: 'save', description: 'Save current session', icon: '💾',
          action: () => SessionManager.save() },
        { name: 'help', description: 'Show available commands', icon: '❓',
          action: () => { /* opening dropdown is the action */ } },
        { name: 'stats', description: 'Show chat statistics', icon: '📊',
          action: () => ChatStats.toggle() },
        { name: 'sessions', description: 'Toggle sessions panel', icon: '📋',
          action: () => SessionManager.toggle() },
        { name: 'stream', description: 'Toggle streaming responses on/off', icon: '⚡',
          action: () => {
            ChatConfig.STREAMING_ENABLED = !ChatConfig.STREAMING_ENABLED;
            try { SafeStorage.set('ac-streaming', JSON.stringify(ChatConfig.STREAMING_ENABLED)); } catch (_) {}
            UIController.setChatOutput(`Streaming ${ChatConfig.STREAMING_ENABLED ? 'enabled ⚡' : 'disabled'}`);
          } },
        { name: 'file', description: 'Open file picker to attach text files', icon: '📎',
          action: () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.txt,.json,.csv,.js,.jsx,.ts,.tsx,.py,.md,.html,.css,.xml,.yaml,.yml,.toml,.ini,.cfg,.log,.sql,.sh,.bat,.ps1,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt';
            input.addEventListener('change', () => {
              if (input.files && input.files.length > 0) {
                FileDropZone.handleFiles(input.files);
              }
            });
            input.click();
          } },
        { name: 'focus', description: 'Toggle focus/zen mode — hide distractions', icon: '🧘',
          action: () => {
            const isActive = FocusMode.toggle();
            UIController.setChatOutput(`Focus mode ${isActive ? 'enabled 🧘' : 'disabled'}`);
          } },
        { name: 'search-all', description: 'Search across all saved sessions', icon: '🔎',
          action: () => GlobalSessionSearch.toggle() },
        { name: 'timing', description: 'Toggle response time badges on/off', icon: '⏱️',
          action: () => {
            const visible = ConversationManager.toggleTiming();
            if (!visible) ResponseTimeBadge.hide();
            UIController.setChatOutput(`Response timing badges ${visible ? 'enabled ⏱️' : 'hidden'}`);
          } },
        { name: 'tags', description: 'Manage conversation tags — add, view, filter', icon: '🏷️',
          action: () => {
            ConversationTags.openManager();
          } },
        { name: 'input-history', description: 'Clear prompt history (↑/↓ navigation)', icon: '🕐',
          action: () => {
            const count = InputHistory.getCount();
            InputHistory.clearAll();
            UIController.setChatOutput(`Cleared ${count} prompt${count !== 1 ? 's' : ''} from input history.`);
          } },
        { name: 'auto-tag', description: 'Auto-detect and apply topic tags to all untagged sessions', icon: '🏷️',
          action: () => {
            const result = AutoTagger.applyToAll();
            if (result.tagged > 0) {
              UIController.setChatOutput(`Auto-tagged ${result.tagged} session${result.tagged !== 1 ? 's' : ''} with ${result.totalApplied} tags.`);
            } else {
              UIController.setChatOutput('No untagged sessions with detectable topics.');
            }
          } },
        { name: 'replay', description: 'Replay conversation message-by-message with transport controls', icon: '🎬',
          action: () => ConversationReplay.start() },
        { name: 'compare', description: 'Compare AI model responses side-by-side', icon: '⚔️',
          action: () => ModelComparePanel.toggle() },
    ]);

    function init() {
        const input = document.getElementById('chat-input');
        if (!input) return;
        input.addEventListener('input', function () {
            handleInput(this.value);
        });
        input.addEventListener('keydown', function (e) {
            handleKeydown(e);
        });
        document.addEventListener('click', function (e) {
            if (isOpen && dropdownEl && !dropdownEl.contains(e.target) && e.target.id !== 'chat-input') {
                hideDropdown();
            }
        });
    }

    function handleInput(value) {
        if (!value || !value.startsWith('/')) {
            hideDropdown();
            return;
        }
        const query = value.slice(1);
        filteredCommands = filter(query);
        if (filteredCommands.length === 0) {
            hideDropdown();
            return;
        }
        selectedIndex = -1;
        showDropdown();
    }

    function filter(query) {
        if (!query && query !== '') return commands.slice();
        const q = query.toLowerCase();
        return commands.filter(cmd => cmd.name.toLowerCase().startsWith(q));
    }

    function showDropdown() {
        if (!dropdownEl) {
            dropdownEl = document.createElement('div');
            dropdownEl.className = 'slash-dropdown';
            const toolbar = document.querySelector('.toolbar');
            if (toolbar) {
                toolbar.style.position = 'relative';
                toolbar.appendChild(dropdownEl);
            } else {
                document.body.appendChild(dropdownEl);
            }
        }
        isOpen = true;
        renderCommands();
    }

    function hideDropdown() {
        if (dropdownEl && dropdownEl.parentNode) {
            dropdownEl.parentNode.removeChild(dropdownEl);
        }
        dropdownEl = null;
        isOpen = false;
        selectedIndex = -1;
        filteredCommands = [];
    }

    function renderCommands() {
        if (!dropdownEl) return;
        dropdownEl.innerHTML = '';
        const visible = filteredCommands.slice(0, MAX_VISIBLE);
        visible.forEach((cmd, i) => {
            const item = document.createElement('div');
            item.className = 'slash-item' + (i === selectedIndex ? ' slash-item-selected' : '');
            const icon = document.createElement('span');
            icon.className = 'slash-item-icon';
            icon.textContent = cmd.icon;
            const name = document.createElement('span');
            name.className = 'slash-item-name';
            name.textContent = '/' + cmd.name;
            const desc = document.createElement('span');
            desc.className = 'slash-item-desc';
            desc.textContent = cmd.description;
            item.appendChild(icon);
            item.appendChild(name);
            item.appendChild(desc);
            item.addEventListener('click', () => executeCommand(cmd));
            dropdownEl.appendChild(item);
        });
        if (filteredCommands.length > MAX_VISIBLE) {
            dropdownEl.style.overflowY = 'auto';
        }
    }

    function handleKeydown(e) {
        if (!isOpen) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % filteredCommands.length;
            renderCommands();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = selectedIndex <= 0 ? filteredCommands.length - 1 : selectedIndex - 1;
            renderCommands();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const idx = selectedIndex >= 0 ? selectedIndex : 0;
            if (filteredCommands[idx]) {
                executeCommand(filteredCommands[idx]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            if (input) input.value = '';
            hideDropdown();
        }
    }

    function executeCommand(command) {
        const input = document.getElementById('chat-input');
        if (input) input.value = '';
        hideDropdown();
        command.action();
    }

    function getCommands() { return commands.slice(); }

    function isDropdownOpen() { return isOpen; }

    return {
        init, handleInput, handleKeydown, showDropdown, hideDropdown,
        executeCommand, getCommands, isDropdownOpen, filter,
        _getState: () => ({ isOpen, selectedIndex, filteredCommands: filteredCommands.slice() })
    };
})();

/* ---------- Message Reactions ---------- */
/**
 * Per-message emoji reactions with persistent counts.
 *
 * Allows users to add/remove emoji reactions (👍 👎 ❤️ 😂 🤔 💡 🎉 ⚠️)
 * on individual messages, identified by their conversation history index.
 * Reactions are persisted to localStorage and rendered as clickable badges
 * below each message. Supports clearing all reactions and re-rendering
 * after DOM updates.
 *
 * @namespace MessageReactions
 */
const MessageReactions = (() => {
    const STORAGE_KEY = 'agenticchat_reactions';
    const AVAILABLE_EMOJIS = ['👍', '👎', '❤️', '😂', '🤔', '💡', '🎉', '⚠️'];
    const MAX_REACTIONS_PER_MESSAGE = 50;
    
    // reactions: { [messageIndex]: { [emoji]: count } }
    let reactions = {};
    
    function init() {
        load();
    }
    
    // Add a reaction to a message (by its index in conversation history)
    function addReaction(messageIndex, emoji) {
        if (!AVAILABLE_EMOJIS.includes(emoji)) return false;
        if (typeof messageIndex !== 'number' || messageIndex < 0) return false;
        
        if (!reactions[messageIndex]) reactions[messageIndex] = {};
        const current = reactions[messageIndex][emoji] || 0;
        if (current >= MAX_REACTIONS_PER_MESSAGE) return false;
        
        reactions[messageIndex][emoji] = current + 1;
        save();
        return true;
    }
    
    // Remove a reaction (decrement count, remove if 0)
    function removeReaction(messageIndex, emoji) {
        if (!reactions[messageIndex] || !reactions[messageIndex][emoji]) return false;
        reactions[messageIndex][emoji]--;
        if (reactions[messageIndex][emoji] <= 0) {
            delete reactions[messageIndex][emoji];
        }
        if (Object.keys(reactions[messageIndex]).length === 0) {
            delete reactions[messageIndex];
        }
        save();
        return true;
    }
    
    // Toggle a reaction (add if not present, remove if already 1)
    function toggleReaction(messageIndex, emoji) {
        if (!AVAILABLE_EMOJIS.includes(emoji)) return false;
        if (typeof messageIndex !== 'number' || messageIndex < 0) return false;
        
        const current = (reactions[messageIndex] && reactions[messageIndex][emoji]) || 0;
        if (current > 0) {
            return removeReaction(messageIndex, emoji);
        } else {
            return addReaction(messageIndex, emoji);
        }
    }
    
    // Get reactions for a message
    function getReactions(messageIndex) {
        if (!reactions[messageIndex]) return {};
        // Return a copy
        const copy = {};
        for (const emoji in reactions[messageIndex]) {
            copy[emoji] = reactions[messageIndex][emoji];
        }
        return copy;
    }
    
    // Get total reaction count for a message
    function getReactionCount(messageIndex) {
        if (!reactions[messageIndex]) return 0;
        let count = 0;
        for (const emoji in reactions[messageIndex]) {
            count += reactions[messageIndex][emoji];
        }
        return count;
    }
    
    // Get all message indices that have reactions
    function getReactedMessages() {
        return Object.keys(reactions).map(Number).sort((a, b) => a - b);
    }
    
    // Clear all reactions for a message
    function clearReactions(messageIndex) {
        if (!reactions[messageIndex]) return 0;
        const count = getReactionCount(messageIndex);
        delete reactions[messageIndex];
        save();
        return count;
    }
    
    // Clear all reactions
    function clearAll() {
        const count = Object.keys(reactions).length;
        reactions = {};
        save();
        return count;
    }
    
    // Get most reacted emoji across all messages
    function getMostUsedEmoji() {
        const totals = {};
        for (const msgIdx in reactions) {
            for (const emoji in reactions[msgIdx]) {
                totals[emoji] = (totals[emoji] || 0) + reactions[msgIdx][emoji];
            }
        }
        let best = null;
        let bestCount = 0;
        for (const emoji in totals) {
            if (totals[emoji] > bestCount) {
                best = emoji;
                bestCount = totals[emoji];
            }
        }
        return best;
    }
    
    // Render reaction bar for a message element in the history panel
    function renderReactionBar(messageElement, messageIndex) {
        // Remove existing reaction bar if any
        const existing = messageElement.querySelector('.reaction-bar');
        if (existing) existing.remove();
        
        const bar = document.createElement('div');
        bar.className = 'reaction-bar';
        bar.setAttribute('data-msg-index', messageIndex);
        
        // Show existing reactions as badges
        const msgReactions = getReactions(messageIndex);
        for (const emoji of AVAILABLE_EMOJIS) {
            if (msgReactions[emoji]) {
                const badge = document.createElement('span');
                badge.className = 'reaction-badge active';
                badge.textContent = emoji + ' ' + msgReactions[emoji];
                badge.setAttribute('data-emoji', emoji);
                badge.setAttribute('role', 'button');
                badge.setAttribute('aria-label', 'Remove ' + emoji + ' reaction');
                badge.addEventListener('click', function() {
                    toggleReaction(messageIndex, emoji);
                    renderReactionBar(messageElement, messageIndex);
                });
                bar.appendChild(badge);
            }
        }
        
        // Add reaction button (picker)
        const addBtn = document.createElement('button');
        addBtn.className = 'reaction-add-btn';
        addBtn.textContent = '+';
        addBtn.setAttribute('aria-label', 'Add reaction');
        addBtn.setAttribute('title', 'Add reaction');
        addBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showEmojiPicker(messageElement, messageIndex, addBtn);
        });
        bar.appendChild(addBtn);
        
        messageElement.appendChild(bar);
    }
    
    // Show emoji picker near the add button
    function showEmojiPicker(messageElement, messageIndex, anchorBtn) {
        // Remove any existing picker
        hideEmojiPicker();
        
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.setAttribute('role', 'listbox');
        picker.setAttribute('aria-label', 'Choose reaction emoji');
        
        for (const emoji of AVAILABLE_EMOJIS) {
            const btn = document.createElement('button');
            btn.className = 'emoji-option';
            btn.textContent = emoji;
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-label', emoji);
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleReaction(messageIndex, emoji);
                hideEmojiPicker();
                renderReactionBar(messageElement, messageIndex);
            });
            picker.appendChild(btn);
        }
        
        anchorBtn.parentElement.appendChild(picker);
        
        // Close on outside click
        setTimeout(function() {
            document.addEventListener('click', _onOutsideClick);
        }, 0);
    }
    
    function _onOutsideClick(e) {
        const picker = document.querySelector('.emoji-picker');
        if (picker && !picker.contains(e.target)) {
            hideEmojiPicker();
        }
    }
    
    function hideEmojiPicker() {
        const picker = document.querySelector('.emoji-picker');
        if (picker) picker.remove();
        document.removeEventListener('click', _onOutsideClick);
    }
    
    // Decorate all history messages with reaction bars
    function decorateMessages() {
        const container = document.getElementById('history-messages');
        if (!container) return;
        const msgs = container.querySelectorAll('.history-msg');
        // Message index = index in ConversationManager (skip system at 0)
        const history = ConversationManager.getHistory();
        let nonSystemIdx = 0;
        for (let i = 0; i < history.length; i++) {
            if (history[i].role === 'system') continue;
            if (nonSystemIdx < msgs.length) {
                renderReactionBar(msgs[nonSystemIdx], i);
            }
            nonSystemIdx++;
        }
    }
    
    function save() {
        try {
            SafeStorage.set(STORAGE_KEY, JSON.stringify(reactions));
        } catch (e) {
            // Storage full — silent fail
        }
    }
    
    function load() {
        try {
            const data = SafeStorage.get(STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    reactions = sanitizeStorageObject(parsed);
                } else {
                    reactions = {};
                }
            }
        } catch (e) {
            reactions = {};
        }
    }
    
    function getAvailableEmojis() {
        return AVAILABLE_EMOJIS.slice();
    }
    
    function _getState() {
        return {
            reactions: JSON.parse(JSON.stringify(reactions)),
            availableEmojis: AVAILABLE_EMOJIS.slice()
        };
    }
    
    function reset() {
        reactions = {};
        SafeStorage.remove(STORAGE_KEY);
    }
    
    return {
        init,
        addReaction,
        removeReaction,
        toggleReaction,
        getReactions,
        getReactionCount,
        getReactedMessages,
        clearReactions,
        clearAll,
        getMostUsedEmoji,
        renderReactionBar,
        showEmojiPicker,
        hideEmojiPicker,
        decorateMessages,
        decorateOne: renderReactionBar,
        getAvailableEmojis,
        _getState,
        reset,
        MAX_REACTIONS_PER_MESSAGE
    };
})();

/* ---------- Keyboard Shortcuts ---------- */
/**
 * Global keyboard shortcuts with a help modal.
 *
 * Registers document-level keydown handlers for common actions:
 * `Enter` (send), `Ctrl+L` (clear), `Ctrl+K` (focus input), `Ctrl+F`
 * (search), `Ctrl+/` (slash commands), `?` (shortcut help), etc.
 * Shortcuts are suppressed when the user is focused on an input/textarea.
 * The help modal lists all available bindings.
 *
 * @namespace KeyboardShortcuts
 */
const KeyboardShortcuts = (() => {
  let isHelpOpen = false;

  /** Check if user is typing in an input/textarea. */
  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || !!el.isContentEditable;
  }

  function showHelp() {
    isHelpOpen = true;
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.classList.add('visible');
  }

  function hideHelp() {
    isHelpOpen = false;
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.classList.remove('visible');
  }

  function toggleHelp() {
    if (isHelpOpen) hideHelp();
    else showHelp();
  }

  function isOpen() {
    return isHelpOpen;
  }

  /**
   * Main keyboard handler.
   * Ctrl+L: clear conversation
   * Ctrl+H: toggle history
   * Ctrl+T: toggle templates
   * Ctrl+S: toggle snippets
   * Ctrl+K: focus chat input
   * ?: show shortcuts help (only when not typing)
   * Escape: close any open panel/modal
   */
  function handleKeydown(e) {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+L — clear conversation
    if (ctrl && e.key === 'l') {
      e.preventDefault();
      ChatController.clearHistory();
      return;
    }

    // Ctrl+H — toggle history panel
    if (ctrl && e.key === 'h') {
      e.preventDefault();
      HistoryPanel.toggle();
      return;
    }

    // Ctrl+T — toggle templates panel
    if (ctrl && e.key === 't') {
      e.preventDefault();
      PromptTemplates.toggle();
      return;
    }

    // Ctrl+S — toggle snippets panel; Ctrl+Shift+S — global session search
    if (ctrl && e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        GlobalSessionSearch.toggle();
      } else {
        SnippetLibrary.toggle();
      }
      return;
    }

    // Ctrl+J — toggle sessions panel
    if (ctrl && e.key === 'j') {
      e.preventDefault();
      SessionManager.toggle();
      return;
    }

    // Ctrl+N — new session
    if (ctrl && e.key === 'n') {
      e.preventDefault();
      SessionManager.newSession();
      return;
    }

    // Ctrl+K — focus chat input
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      if (input) input.focus();
      return;
    }

    // Ctrl+B — toggle bookmarks panel
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      ChatBookmarks.togglePanel();
      return;
    }

    // Ctrl+F — toggle message search
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      MessageSearch.toggle();
      return;
    }

    // Ctrl+M — toggle voice input
    if (ctrl && e.key === 'm') {
      e.preventDefault();
      const voiceBtn = document.getElementById('voice-btn');
      if (voiceBtn && !voiceBtn.disabled) voiceBtn.click();
      return;
    }

    // Ctrl+D — toggle dark/light theme
    if (ctrl && e.key === 'd') {
      e.preventDefault();
      ThemeManager.toggle();
      return;
    }

    // Ctrl+P — toggle persona presets
    if (ctrl && e.key === 'p') {
      e.preventDefault();
      PersonaPresets.toggle();
      return;
    }

    // Ctrl+I — toggle chat statistics
    if (ctrl && e.key === 'i') {
      e.preventDefault();
      ChatStats.toggle();
      return;
    }

    // Ctrl+. — toggle scratchpad
    if (ctrl && e.key === '.') {
      e.preventDefault();
      Scratchpad.toggle();
      return;
    }

    // ? — show shortcuts help (only when not typing in an input)
    if (e.key === '?' && !ctrl && !e.altKey && !isInputFocused()) {
      e.preventDefault();
      toggleHelp();
      return;
    }

    // Escape — close shortcuts help (other panels handled by existing handler)
    if (e.key === 'Escape' && isHelpOpen) {
      hideHelp();
      // Don't return — let existing Escape handler also close other panels
    }

    // Escape — close search bar
    if (e.key === 'Escape' && MessageSearch.isSearchOpen()) {
      MessageSearch.close();
    }
  }

  return { showHelp, hideHelp, toggleHelp, isOpen, handleKeydown, isInputFocused };
})();

/* ---------- Voice Input ---------- */
/**
 * Browser speech-to-text via the Web Speech API (SpeechRecognition).
 *
 * Provides continuous voice recognition with configurable language (persisted
 * to localStorage). Supports interim results for real-time transcription,
 * optional auto-send on recognition end, and a language-selector dropdown.
 * Gracefully degrades when the browser doesn't support the Web Speech API.
 *
 * @namespace VoiceInput
 */
const VoiceInput = (() => {
  let recognition = null;
  let isListening = false;
  let finalTranscript = '';
  let interimTranscript = '';
  let _onResult = null;
  let _onStateChange = null;
  let _autoSend = false;

  const LANG_STORAGE_KEY = 'agenticchat_voice_lang';
  const DEFAULT_LANG = 'en-US';

  /** Load saved language preference from localStorage, fallback to default. */
  function _loadLanguage() {
    try {
      const saved = SafeStorage.get(LANG_STORAGE_KEY);
      if (saved && typeof saved === 'string' && saved.length >= 2 && saved.length <= 10) {
        return saved;
      }
    } catch (_) { /* localStorage unavailable */ }
    return DEFAULT_LANG;
  }

  /** Persist language preference to localStorage. */
  function _saveLanguage(lang) {
    try {
      SafeStorage.set(LANG_STORAGE_KEY, lang);
    } catch (_) { /* localStorage unavailable */ }
  }

  /** Check if Speech Recognition is available in this browser. */
  function isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /** Initialize the recognition engine. Idempotent. */
  function _ensureRecognition() {
    if (recognition) return recognition;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = _loadLanguage();
    recognition.maxAlternatives = 1;

    recognition.addEventListener('result', (event) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      if (_onResult) {
        _onResult(finalTranscript, interimTranscript);
      }
    });

    recognition.addEventListener('error', (event) => {
      // 'no-speech' and 'aborted' are soft errors — don't stop listening
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      stop();
    });

    recognition.addEventListener('end', () => {
      // Auto-restart if we're still supposed to be listening
      // (browser can stop recognition after silence)
      if (isListening) {
        try { recognition.start(); } catch (_) {}
      }
    });

    return recognition;
  }

  /** Start listening. */
  function start() {
    if (isListening) return;
    if (!isSupported()) return;

    const rec = _ensureRecognition();
    if (!rec) return;

    finalTranscript = '';
    interimTranscript = '';
    isListening = true;

    try {
      rec.start();
    } catch (_) {
      // Already started — ignore
    }

    if (_onStateChange) _onStateChange(true);
  }

  /** Stop listening and return the final transcript. */
  function stop() {
    if (!isListening) return '';
    isListening = false;

    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }

    if (_onStateChange) _onStateChange(false);

    const result = (finalTranscript + interimTranscript).trim();
    finalTranscript = '';
    interimTranscript = '';
    return result;
  }

  /** Toggle listening on/off. Returns true if now listening. */
  function toggle() {
    if (isListening) {
      const transcript = stop();
      return { listening: false, transcript };
    } else {
      start();
      return { listening: true, transcript: '' };
    }
  }

  function getIsListening() { return isListening; }
  function getFinalTranscript() { return finalTranscript; }
  function getInterimTranscript() { return interimTranscript; }

  /** Set callback for speech results: (finalText, interimText) => void */
  function onResult(fn) { _onResult = fn; }

  /** Set callback for state changes: (isListening) => void */
  function onStateChange(fn) { _onStateChange = fn; }

  /** Set the recognition language (e.g. 'en-US', 'es-ES', 'fr-FR'). Persists to localStorage. */
  function setLanguage(lang) {
    if (!lang || typeof lang !== 'string') return;
    const trimmed = lang.trim();
    if (trimmed.length < 2 || trimmed.length > 10) return;
    _saveLanguage(trimmed);
    if (recognition) recognition.lang = trimmed;
  }

  /** Get current language. */
  function getLanguage() {
    return recognition ? recognition.lang : _loadLanguage();
  }

  return {
    isSupported, start, stop, toggle,
    getIsListening, getFinalTranscript, getInterimTranscript,
    onResult, onStateChange, setLanguage, getLanguage
  };
})();

/* ---------- Theme Manager ---------- */
/**
 * Dark/light theme manager with OS preference detection.
 *
 * Persists the user's theme choice to localStorage. On first load, detects
 * the OS-level `prefers-color-scheme` media query to pick a default. Applies
 * the theme by toggling CSS classes on `document.documentElement` and
 * updates the theme-toggle button icon.
 *
 * @namespace ThemeManager
 */
const ThemeManager = (() => {
  const STORAGE_KEY = 'agenticchat_theme';
  const THEMES = ['dark', 'light'];
  let currentTheme = 'dark';

  /** Load saved theme or detect system preference. */
  function init() {
    const saved = _loadSaved();
    if (saved && THEMES.includes(saved)) {
      currentTheme = saved;
    } else if (typeof window !== 'undefined' && window.matchMedia) {
      // Detect OS-level preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      currentTheme = prefersDark.matches ? 'dark' : 'light';
    }
    _apply(currentTheme);
    _updateButton();
  }

  /** Toggle between dark and light themes. */
  function toggle() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    _apply(currentTheme);
    _save(currentTheme);
    _updateButton();
    return currentTheme;
  }

  /** Set a specific theme. */
  function setTheme(theme) {
    if (!THEMES.includes(theme)) return currentTheme;
    currentTheme = theme;
    _apply(currentTheme);
    _save(currentTheme);
    _updateButton();
    return currentTheme;
  }

  /** Get the current theme name. */
  function getTheme() {
    return currentTheme;
  }

  /** Get available theme names. */
  function getThemes() {
    return [...THEMES];
  }

  function _apply(theme) {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function _save(theme) {
    try { SafeStorage.set(STORAGE_KEY, theme); } catch (_) {}
  }

  function _loadSaved() {
    try { return SafeStorage.get(STORAGE_KEY); } catch (_) { return null; }
  }

  function _updateButton() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    if (currentTheme === 'dark') {
      btn.textContent = '☀️';
      btn.title = 'Switch to light theme (Ctrl+D)';
    } else {
      btn.textContent = '🌙';
      btn.title = 'Switch to dark theme (Ctrl+D)';
    }
  }

  return { init, toggle, setTheme, getTheme, getThemes };
})();

/* ---------- Session Manager ---------- */
/**
 * Multi-session persistence manager with auto-save and storage quota handling.
 *
 * Stores up to {@link MAX_SESSIONS} (50) named conversation sessions in
 * localStorage, each with full message history, creation/update timestamps,
 * and character counts. Supports manual save/load/delete, auto-save on every
 * message, session renaming, and JSON import/export. Handles `QuotaExceededError`
 * by evicting the oldest sessions. Sessions older than {@link MAX_MESSAGE_AGE_DAYS}
 * (90 days) are pruned automatically.
 *
 * On load, clears {@link ChatBookmarks} to avoid stale DOM index references.
 *
 * @namespace SessionManager
 */
const SessionManager = (() => {
  const STORAGE_KEY = 'agenticchat_sessions';
  const ACTIVE_KEY = 'agenticchat_active_session';
  const AUTO_SAVE_KEY = 'agenticchat_autosave';
  const MAX_SESSIONS = 50;
  const MAX_MESSAGE_AGE_DAYS = 90;
  const QUOTA_WARNING_THRESHOLD = 0.8;  // 80% of estimated quota
  let isOpen = false;
  let autoSave = false;

  // ── In-memory cache (fixes #36) ─────────────────────────────
  // Avoids redundant JSON.parse on every operation. The cache is
  // invalidated when another tab writes (StorageEvent / BroadcastChannel)
  // or when the raw localStorage value diverges from our last-known
  // snapshot (same-tab external writes).  The hot-path short-circuits
  // entirely when the raw value hasn't changed, skipping both
  // JSON.parse AND sanitizeStorageObject.
  let _cache = null;
  let _cacheDirty = true;
  let _cacheRawLen = -1;  // length of raw string at last parse

  /** Load all sessions from localStorage (cached). */
  function _loadAll() {
    if (!_cacheDirty && _cache !== null) {
      // Quick length check to detect external writes (cheap O(1))
      try {
        const raw = SafeStorage.get(STORAGE_KEY);
        if (raw !== null && raw !== undefined && raw.length === _cacheRawLen) {
          return _cache;
        }
      } catch { /* fall through */ }
    }
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      _cacheRawLen = raw ? raw.length : 0;
      _cache = raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch { _cache = []; _cacheRawLen = -1; }
    _cacheDirty = false;
    return _cache;
  }

  /** Save all sessions to localStorage with quota protection. */
  function _saveAll(sessions) {
    // Update cache before writing so subsequent reads are instant
    _cache = sessions;
    _cacheDirty = false;
    const json = JSON.stringify(sessions);
    _cacheRawLen = json.length;
    try {
        SafeStorage.set(STORAGE_KEY, json);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            // Incrementally evict oldest sessions one at a time until it fits,
            // but always keep at least one session to prevent total data loss.
            let remaining = [...sessions];
            while (remaining.length > 1) {
                remaining = _evictOldest(remaining, 1);
                try {
                    const evictedJson = JSON.stringify(remaining);
                    SafeStorage.set(STORAGE_KEY, evictedJson);
                    _cache = remaining;
                    _cacheRawLen = evictedJson.length;
                    console.warn(`[SessionManager] Evicted session to fit quota. ${remaining.length} sessions remain.`);
                    return true;
                } catch { /* continue evicting */ }
            }
            // Last resort: try saving the single remaining session
            try {
                const lastJson = JSON.stringify(remaining);
                SafeStorage.set(STORAGE_KEY, lastJson);
                _cache = remaining;
                _cacheRawLen = lastJson.length;
                console.warn('[SessionManager] Evicted all but one session to fit quota.');
                return true;
            } catch {
                console.error('[SessionManager] Cannot save even a single session. Storage may be full.');
                return false;
            }
        }
        return false;
    }
  }

  /** Evict the N oldest sessions (by updatedAt), always keeping at least one. */
  function _evictOldest(sessions, count) {
    if (sessions.length <= 1) return sessions;
    const toEvict = Math.min(count, sessions.length - 1);
    const sorted = [...sessions].sort((a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
    return sorted.slice(toEvict);
  }

  /** Enforce maximum session count, evicting oldest when exceeded. */
  function _enforceSessionLimit(sessions) {
    if (sessions.length <= MAX_SESSIONS) return sessions;
    const sorted = [...sessions].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return sorted.slice(0, MAX_SESSIONS);
  }

  /** Estimate localStorage usage as a fraction of the ~5MB quota. */
  function _estimateQuotaUsage() {
    try {
        let total = 0;
        for (let i = 0; i < SafeStorage.length; i++) {
            const key = SafeStorage.key(i);
            total += key.length + (SafeStorage.get(key) || '').length;
        }
        // 5MB ≈ 5,242,880 chars (UTF-16 = 2 bytes per char, but length counts chars)
        return total / (5 * 1024 * 1024);
    } catch { return 0; }
  }

  /** Check quota and show a warning if usage is high. Returns usage fraction. */
  function _checkQuota() {
    const usage = _estimateQuotaUsage();
    if (usage >= QUOTA_WARNING_THRESHOLD) {
        const pct = Math.round(usage * 100);
        console.warn(`[SessionManager] localStorage usage is at ${pct}%. Consider clearing old sessions.`);
    }
    return usage;
  }

  /** Get or set the active session ID. */
  function _getActiveId() {
    try { return SafeStorage.get(ACTIVE_KEY) || null; } catch { return null; }
  }
  function _setActiveId(id) {
    try {
      if (id) SafeStorage.set(ACTIVE_KEY, id);
      else SafeStorage.remove(ACTIVE_KEY);
    } catch {}
  }

  /** Initialize auto-save preference. */
  function initAutoSave() {
    try {
      autoSave = SafeStorage.get(AUTO_SAVE_KEY) === 'true';
    } catch { autoSave = false; }
    _updateAutoSaveUI();
  }

  function isAutoSaveEnabled() { return autoSave; }

  function toggleAutoSave() {
    autoSave = !autoSave;
    try { SafeStorage.set(AUTO_SAVE_KEY, String(autoSave)); } catch {}
    _updateAutoSaveUI();
    return autoSave;
  }

  function _updateAutoSaveUI() {
    const toggle = document.getElementById('sessions-autosave');
    if (toggle) {
      toggle.checked = autoSave;
      toggle.title = autoSave ? 'Auto-save is ON' : 'Auto-save is OFF';
    }
  }

  /** Get all sessions sorted by updatedAt (newest first). */
  function getAll() {
    return _loadAll().sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /** Get the count of saved sessions. */
  function getCount() {
    return _loadAll().length;
  }

  /**
   * Save the current conversation as a named session.
   * If activeId matches an existing session, updates it. Otherwise creates new.
   */
  function save(name) {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0 && !name) return null;

    const sessions = _loadAll();
    const activeId = _getActiveId();
    const now = new Date().toISOString();

    // Check if we're updating an existing session
    const existing = activeId ? sessions.find(s => s.id === activeId) : null;

    if (existing) {
      existing.messages = messages;
      existing.messageCount = messages.length;
      existing.updatedAt = now;
      if (name && name.trim()) existing.name = name.trim().substring(0, 200);
      // Update preview from last user message
      const lastUser = messages.filter(m => m.role === 'user').pop();
      existing.preview = lastUser
        ? lastUser.content.substring(0, 120)
        : existing.preview;
      _saveAll(sessions);
      return existing;
    }

    // Create new session
    const sessionName = (name && name.trim())
      ? name.trim().substring(0, 200)
      : _generateName(messages);
    const lastUser = messages.filter(m => m.role === 'user').pop();

    const session = {
      id: crypto.randomUUID(),
      name: sessionName,
      messages,
      messageCount: messages.length,
      preview: lastUser ? lastUser.content.substring(0, 120) : '',
      createdAt: now,
      updatedAt: now
    };

    sessions.unshift(session);
    const trimmed = _enforceSessionLimit(sessions);
    _saveAll(trimmed);
    _setActiveId(session.id);
    return session;
  }

  /** Auto-save the current session (called after each message). */
  function autoSaveIfEnabled() {
    if (!autoSave) return;
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) return;

    save();
    if (isOpen) refresh();
  }

  /** Generate a session name from the first user message. */
  function _generateName(messages) {
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) {
      const text = firstUser.content.trim();
      if (text.length <= 40) return text;
      return text.substring(0, 37) + '…';
    }
    return `Session ${new Date().toLocaleString()}`;
  }

  /** Auto-save the current conversation if auto-save is enabled. */
  function _autoSaveCurrent() {
    const currentMessages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (autoSave && currentMessages.length > 0) {
      save();
    }
  }

  /** Reset UI state after switching or clearing a session. */
  function _resetUI(statusText) {
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt(statusText);
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    HistoryPanel.refresh();
  }

  /** Load a session by ID — replaces current conversation. */
  function load(id) {
    const sessions = _loadAll();
    const session = sessions.find(s => s.id === id);
    if (!session) return null;

    _autoSaveCurrent();

    // Clear third-party service keys from the previous session context.
    // Different sessions may interact with different APIs; lingering keys
    // from session A should not auto-apply when running code in session B.
    ApiKeyManager.clearServiceKeys();

    // Replace conversation history
    ConversationManager.clear();
    session.messages.forEach(msg => {
      // Defense-in-depth: only load user/assistant messages even from
      // localStorage (could be tampered via dev tools or XSS)
      if (msg && typeof msg.role === 'string' && typeof msg.content === 'string'
          && (msg.role === 'user' || msg.role === 'assistant')) {
        ConversationManager.addMessage(msg.role, msg.content);
      }
    });

    _setActiveId(session.id);
    _resetUI(`Loaded: ${session.name}`);

    return session;
  }

  /** Delete a session by ID. */
  function remove(id) {
    const sessions = _loadAll().filter(s => s.id !== id);
    _saveAll(sessions);
    if (_getActiveId() === id) _setActiveId(null);
    // Clean up tags for deleted session
    if (typeof ConversationTags !== 'undefined') {
      ConversationTags.clearSession(id);
    }
    return sessions;
  }

  /** Rename a session. */
  function rename(id, newName) {
    const sessions = _loadAll();
    const session = sessions.find(s => s.id === id);
    if (session && newName && newName.trim()) {
      // Cap length to prevent oversized localStorage entries
      session.name = newName.trim().substring(0, 200);
      session.updatedAt = new Date().toISOString();
      _saveAll(sessions);
    }
    return sessions;
  }

  /** Start a new empty session. Optionally saves current first. */
  function newSession() {
    _autoSaveCurrent();

    ConversationManager.clear();
    _setActiveId(null);
    _resetUI('(new session)');
    if (isOpen) refresh();
  }

  /** Duplicate a session. */
  function duplicate(id) {
    const sessions = _loadAll();
    const original = sessions.find(s => s.id === id);
    if (!original) return null;

    const now = new Date().toISOString();
    const copy = {
      id: crypto.randomUUID(),
      name: original.name + ' (copy)',
      messages: JSON.parse(JSON.stringify(original.messages)),
      messageCount: original.messageCount,
      preview: original.preview,
      createdAt: now,
      updatedAt: now
    };

    sessions.unshift(copy);
    _saveAll(sessions);
    return copy;
  }

  /** Export a session as JSON. */
  function exportSession(id) {
    const sessions = _loadAll();
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    const data = {
      exported: new Date().toISOString(),
      model: ChatConfig.MODEL,
      session: {
        name: session.name,
        messageCount: session.messageCount,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages
      }
    };

    const safeName = session.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    downloadBlob(`session-${safeName}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  /** Import a session from a JSON file. */
  function importSession(jsonString) {
    try {
      const data = sanitizeStorageObject(JSON.parse(jsonString));
      if (!data.session || !data.session.messages) {
        throw new Error('Invalid session format');
      }

      // --- Input validation (security) ---
      // Imported files are untrusted. Validate message structure and
      // strip system-role messages to prevent prompt injection.
      const rawMessages = data.session.messages;
      if (!Array.isArray(rawMessages)) {
        throw new Error('Messages must be an array');
      }

      const ALLOWED_ROLES = { user: true, assistant: true };
      const MAX_CONTENT_LENGTH = 200000; // 200 KB per message
      const MAX_MESSAGES = 500;
      const MAX_NAME_LENGTH = 200;

      const validatedMessages = [];
      const limit = Math.min(rawMessages.length, MAX_MESSAGES);
      for (let i = 0; i < limit; i++) {
        const msg = rawMessages[i];
        if (!msg || typeof msg !== 'object') continue;
        if (typeof msg.role !== 'string' || typeof msg.content !== 'string') continue;

        // Only allow user/assistant — block system/function/tool roles
        // to prevent prompt injection via imported sessions
        if (!ALLOWED_ROLES[msg.role]) continue;

        // Truncate excessively large content
        const content = msg.content.length > MAX_CONTENT_LENGTH
          ? msg.content.substring(0, MAX_CONTENT_LENGTH)
          : msg.content;

        validatedMessages.push({ role: msg.role, content: content });
      }

      if (validatedMessages.length === 0) {
        throw new Error('No valid messages found in import');
      }

      // Sanitize session name
      const rawName = typeof data.session.name === 'string'
        ? data.session.name.trim().substring(0, MAX_NAME_LENGTH)
        : '';

      const now = new Date().toISOString();
      const session = {
        id: crypto.randomUUID(),
        name: rawName || 'Imported Session',
        messages: validatedMessages,
        messageCount: validatedMessages.length,
        preview: '',
        createdAt: now,
        updatedAt: now
      };

      const lastUser = session.messages.filter(m => m.role === 'user').pop();
      session.preview = lastUser ? lastUser.content.substring(0, 120) : '';

      const sessions = _loadAll();
      sessions.unshift(session);
      _saveAll(sessions);
      return session;
    } catch (e) {
      return null;
    }
  }

  /** Clear all saved sessions. */
  function clearAll() {
    _saveAll([]);
    _setActiveId(null);
    // Purge in-memory API keys to prevent credential leakage
    // across session boundaries.
    ApiKeyManager.clearServiceKeys();
  }

  /** Toggle sessions panel. */
  function toggle() {
    isOpen = !isOpen;
    const panel = document.getElementById('sessions-panel');
    const overlay = document.getElementById('sessions-overlay');
    if (isOpen) {
      panel.classList.add('open');
      overlay.classList.add('visible');
      refresh();
    } else {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function close() {
    isOpen = false;
    const panel = document.getElementById('sessions-panel');
    const overlay = document.getElementById('sessions-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  /** Render the sessions list. */
  function refresh() {
    const container = document.getElementById('sessions-list');
    const countEl = document.getElementById('sessions-count');
    if (!container) return;

    const sessions = getAll();
    const activeId = _getActiveId();

    if (countEl) {
      countEl.textContent = sessions.length === 0 ? '' :
        `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
    }

    if (sessions.length === 0) {
      container.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'sessions-empty';
      empty.textContent = 'No saved sessions.\nSend messages and save, or enable auto-save.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    // Render tag filter bar if active
    if (typeof ConversationTags !== 'undefined') {
      const filterTag = ConversationTags.getActiveFilter();
      if (filterTag) {
        ConversationTags.setFilter(filterTag); // renders the filter bar
      }
    }

    sessions.forEach(session => {
      // Skip sessions that don't match the active tag filter
      if (typeof ConversationTags !== 'undefined' &&
          !ConversationTags.matchesFilter(session.id)) {
        return;
      }

      const card = document.createElement('div');
      card.className = 'session-card';
      if (session.id === activeId) card.classList.add('session-active');
      card.dataset.id = session.id;

      // Header: name + badge
      const header = document.createElement('div');
      header.className = 'session-card-header';

      const nameEl = document.createElement('span');
      nameEl.className = 'session-name';
      nameEl.textContent = session.name;
      nameEl.title = 'Double-click to rename';
      nameEl.addEventListener('dblclick', () => _startRename(session.id, nameEl));
      header.appendChild(nameEl);

      if (session.id === activeId) {
        const badge = document.createElement('span');
        badge.className = 'session-badge';
        badge.textContent = 'active';
        header.appendChild(badge);
      }

      card.appendChild(header);

      // Meta: message count + time
      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = `${session.messageCount} msg${session.messageCount !== 1 ? 's' : ''} · ${formatRelativeTime(session.updatedAt)}`;
      meta.title = `Created: ${new Date(session.createdAt).toLocaleString()}\nUpdated: ${new Date(session.updatedAt).toLocaleString()}`;
      card.appendChild(meta);

      // Tags
      if (typeof ConversationTags !== 'undefined') {
        card.appendChild(ConversationTags.renderTagPills(session.id));
      }

      // Preview
      if (session.preview) {
        const preview = document.createElement('div');
        preview.className = 'session-preview';
        preview.textContent = session.preview;
        card.appendChild(preview);
      }

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'session-card-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn-sm';
      loadBtn.textContent = '📂 Load';
      loadBtn.title = 'Load this session';
      loadBtn.addEventListener('click', () => {
        load(session.id);
        close();
      });
      actions.appendChild(loadBtn);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn-sm';
      exportBtn.textContent = '📤 Export';
      exportBtn.title = 'Export as JSON';
      exportBtn.addEventListener('click', () => exportSession(session.id));
      actions.appendChild(exportBtn);

      const dupBtn = document.createElement('button');
      dupBtn.className = 'btn-sm';
      dupBtn.textContent = '📋 Copy';
      dupBtn.title = 'Duplicate session';
      dupBtn.addEventListener('click', () => {
        duplicate(session.id);
        refresh();
      });
      actions.appendChild(dupBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-sm btn-danger-sm';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Delete session';
      deleteBtn.addEventListener('click', () => {
        remove(session.id);
        refresh();
      });
      actions.appendChild(deleteBtn);

      // Auto-tag button
      if (typeof AutoTagger !== 'undefined') {
        const autoTagBtn = document.createElement('button');
        autoTagBtn.className = 'btn-sm';
        autoTagBtn.textContent = '🏷️ Auto';
        autoTagBtn.title = 'Suggest tags based on conversation content';
        autoTagBtn.addEventListener('click', () => {
          AutoTagger.showSuggestionModal(session.id);
        });
        actions.appendChild(autoTagBtn);
      }

      card.appendChild(actions);
      fragment.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /** Inline rename on double-click. */
  function _startRename(id, nameEl) {
    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-rename-input';
    input.value = currentName;

    function finishRename() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        rename(id, newName);
      }
      refresh();
    }

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }

  /** Open save dialog. */
  function openSaveDialog() {
    const modal = document.getElementById('session-save-modal');
    const nameInput = document.getElementById('session-name-input');
    if (!modal || !nameInput) return;

    // Pre-fill with existing session name or auto-generated
    const activeId = _getActiveId();
    const sessions = _loadAll();
    const active = activeId ? sessions.find(s => s.id === activeId) : null;

    if (active) {
      nameInput.value = active.name;
    } else {
      const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
      nameInput.value = _generateName(messages);
    }

    modal.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  }

  /** Confirm save from dialog. */
  function confirmSave() {
    const nameInput = document.getElementById('session-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) { if (nameInput) nameInput.focus(); return; }

    const session = save(name);
    closeSaveDialog();

    if (session) {
      UIController.setLastPrompt(`Saved: ${session.name}`);
    }

    if (isOpen) refresh();
  }

  function closeSaveDialog() {
    const modal = document.getElementById('session-save-modal');
    if (modal) modal.style.display = 'none';
  }

  /** Handle import from file input. */
  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const session = importSession(reader.result);
        if (session) {
          UIController.setLastPrompt(`Imported: ${session.name}`);
          if (isOpen) refresh();
        } else {
          alert('Invalid session file format.');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  /** Handle clear all with confirmation. */
  function handleClearAll() {
    const count = getCount();
    if (count === 0) return;
    if (!confirm(`Delete all ${count} saved session${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    clearAll();
    refresh();
  }

  /** Get storage usage information. */
  function getStorageInfo() {
    const sessions = _loadAll();
    const usage = _estimateQuotaUsage();
    return {
        sessionCount: sessions.length,
        maxSessions: MAX_SESSIONS,
        quotaUsage: usage,
        quotaWarning: usage >= QUOTA_WARNING_THRESHOLD,
    };
  }

  /** Remove sessions older than MAX_MESSAGE_AGE_DAYS. */
  function handleClearOld() {
    const sessions = _loadAll();
    const cutoff = Date.now() - MAX_MESSAGE_AGE_DAYS * 24 * 60 * 60 * 1000;
    const kept = sessions.filter(s =>
        new Date(s.updatedAt).getTime() > cutoff
    );
    const removed = sessions.length - kept.length;
    if (removed === 0) {
        alert('No sessions older than ' + MAX_MESSAGE_AGE_DAYS + ' days found.');
        return;
    }
    if (confirm(`Remove ${removed} session(s) older than ${MAX_MESSAGE_AGE_DAYS} days?`)) {
        _saveAll(kept);
        if (isOpen) refresh();
    }
  }

  return {
    getAll, getCount, save, load, remove, rename, duplicate,
    newSession, exportSession, importSession, clearAll,
    isAutoSaveEnabled, toggleAutoSave, autoSaveIfEnabled, initAutoSave,
    toggle, close, refresh,
    openSaveDialog, confirmSave, closeSaveDialog,
    handleImport, handleClearAll,
    getStorageInfo, handleClearOld,
    getActiveId: _getActiveId,
    _isOpen: function () { return isOpen; },
    /** Invalidate the in-memory cache, forcing a fresh parse on next read. */
    invalidateCache() { _cacheDirty = true; _cache = null; },
    // Exposed for testing
    _loadAll, _saveAll, _getActiveId, _setActiveId,
    _evictOldest, _enforceSessionLimit, _estimateQuotaUsage, _checkQuota
  };
})();

/* ---------- Cross-Tab Sync ---------- */
/**
 * Prevents multi-tab data corruption by detecting cross-tab localStorage
 * changes via the `storage` event and coordinating writes via BroadcastChannel.
 *
 * When another tab modifies session data, this tab detects it and shows a
 * non-intrusive banner offering Reload / Keep mine options. Uses a tab ID
 * to distinguish own writes from external ones.
 *
 * Fixes: https://github.com/sauravbhattacharya001/agenticchat/issues/30
 *
 * @namespace CrossTabSync
 */
const CrossTabSync = (() => {
  const SESSION_STORAGE_KEY = 'agenticchat_sessions';
  const ACTIVE_STORAGE_KEY = 'agenticchat_active_session';
  const TAB_ID_KEY = 'agenticchat_tab_id';
  const WRITE_STAMP_KEY = 'agenticchat_last_writer';

  const tabId = crypto.randomUUID();
  let channel = null;
  let bannerVisible = false;
  let lastKnownSessionsJSON = null;
  let suppressNextStorageEvent = false;

  /**
   * Initialize cross-tab sync listeners.
   * Call once on DOMContentLoaded.
   */
  function init() {
    // Snapshot current state so we can detect external changes
    try {
      lastKnownSessionsJSON = SafeStorage.get(SESSION_STORAGE_KEY);
    } catch { /* ignore */ }

    // Listen for localStorage changes from OTHER tabs
    // (the `storage` event only fires in tabs that did NOT make the change)
    window.addEventListener('storage', _onStorageEvent);

    // Set up BroadcastChannel for real-time cross-tab messaging
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('agenticchat_sync');
        channel.onmessage = _onBroadcastMessage;
      } catch { /* BroadcastChannel not available */ }
    }

    // Wire up banner buttons
    const reloadBtn = document.getElementById('cross-tab-reload');
    const keepBtn = document.getElementById('cross-tab-keep');
    const dismissBtn = document.getElementById('cross-tab-dismiss');
    if (reloadBtn) reloadBtn.addEventListener('click', _handleReload);
    if (keepBtn) keepBtn.addEventListener('click', _handleKeepMine);
    if (dismissBtn) dismissBtn.addEventListener('click', _hideBanner);

    // Mark our writes: patch SessionManager._saveAll to stamp our tab ID
    _patchSessionManagerWrites();
  }

  /**
   * Patch SessionManager's save operations to stamp the writer tab ID.
   * This lets us distinguish our own writes from other tabs' writes
   * when the storage event fires (belt-and-suspenders with the native
   * behavior where storage events only fire in other tabs).
   */
  function _patchSessionManagerWrites() {
    const originalSaveAll = SessionManager._saveAll;
    SessionManager._saveAll = function(sessions) {
      // Stamp our tab ID before writing
      try {
        SafeStorage.set(WRITE_STAMP_KEY, tabId);
      } catch { /* ignore */ }
      suppressNextStorageEvent = true;
      const result = originalSaveAll(sessions);
      // Update our snapshot after our own write
      try {
        lastKnownSessionsJSON = SafeStorage.get(SESSION_STORAGE_KEY);
      } catch { /* ignore */ }
      // Broadcast to other tabs
      _broadcast({ type: 'sessions-updated', tabId });
      return result;
    };

    // Also patch _setActiveId
    const originalSetActive = SessionManager._setActiveId;
    SessionManager._setActiveId = function(id) {
      try {
        SafeStorage.set(WRITE_STAMP_KEY, tabId);
      } catch { /* ignore */ }
      originalSetActive(id);
      _broadcast({ type: 'active-session-changed', tabId, sessionId: id });
    };
  }

  /**
   * Handle the native `storage` event (fires in other tabs only).
   */
  function _onStorageEvent(e) {
    if (suppressNextStorageEvent) {
      suppressNextStorageEvent = false;
      return;
    }

    if (e.key === SESSION_STORAGE_KEY) {
      // Another tab modified sessions — invalidate the in-memory cache
      // so the next SessionManager read will re-parse from localStorage.
      SessionManager.invalidateCache();
      // Check if it's actually different from what we know
      if (e.newValue !== lastKnownSessionsJSON) {
        _showBanner('⚠️ Another tab modified your sessions.');
      }
    }

    if (e.key === ACTIVE_STORAGE_KEY) {
      // Another tab switched sessions
      _showBanner('⚠️ Another tab switched the active session.');
    }
  }

  /**
   * Handle BroadcastChannel messages from other tabs.
   */
  function _onBroadcastMessage(e) {
    if (!e.data || e.data.tabId === tabId) return; // Ignore our own

    if (e.data.type === 'sessions-updated') {
      SessionManager.invalidateCache();
      _showBanner('⚠️ Another tab modified your sessions.');
    } else if (e.data.type === 'active-session-changed') {
      _showBanner('⚠️ Another tab switched the active session.');
    }
  }

  /**
   * Send a message to all other tabs via BroadcastChannel.
   */
  function _broadcast(message) {
    if (channel) {
      try { channel.postMessage(message); } catch { /* ignore */ }
    }
  }

  /**
   * Show the conflict banner with a given message.
   */
  function _showBanner(message) {
    const banner = document.getElementById('cross-tab-banner');
    const msgEl = document.getElementById('cross-tab-message');
    if (!banner || !msgEl) return;

    msgEl.textContent = message;
    banner.style.display = 'flex';
    bannerVisible = true;
  }

  /**
   * Hide the conflict banner.
   */
  function _hideBanner() {
    const banner = document.getElementById('cross-tab-banner');
    if (banner) banner.style.display = 'none';
    bannerVisible = false;
  }

  /**
   * Reload: pull fresh data from localStorage into this tab's state.
   */
  function _handleReload() {
    _hideBanner();
    try {
      lastKnownSessionsJSON = SafeStorage.get(SESSION_STORAGE_KEY);
    } catch { /* ignore */ }

    // Reload the active session from storage
    const activeId = SessionManager._getActiveId();
    if (activeId) {
      SessionManager.load(activeId);
    } else {
      // No active session — just refresh the sessions panel if open
      SessionManager.refresh();
    }
    // Refresh panels
    HistoryPanel.refresh();
  }

  /**
   * Keep mine: overwrite localStorage with this tab's current state.
   */
  function _handleKeepMine() {
    _hideBanner();
    // Re-save current session to assert this tab's version
    SessionManager.autoSaveIfEnabled();
    // If auto-save is off, force a save anyway
    if (!SessionManager.isAutoSaveEnabled()) {
      SessionManager.save();
    }
  }

  /**
   * Clean up on page unload.
   */
  function destroy() {
    window.removeEventListener('storage', _onStorageEvent);
    if (channel) {
      try { channel.close(); } catch { /* ignore */ }
      channel = null;
    }
  }

  return { init, destroy, _showBanner, _hideBanner, getTabId: () => tabId };
})();

/* ---------- Conversation Sessions (facade) ---------- */
const ConversationSessions = (function () {
  let _confirmPending = false;

  function save(name) {
    return SessionManager.save(name || undefined);
  }

  function load(id) {
    return SessionManager.load(id);
  }

  function rename(id, newName) {
    SessionManager.rename(id, newName);
  }

  function deleteSession(id) {
    SessionManager.remove(id);
  }

  function list() {
    return SessionManager.getAll();
  }

  function getCurrent() {
    return SessionManager._getActiveId();
  }

  function exportSession(id) {
    let sessions = SessionManager._loadAll();
    let session = sessions.find(function (s) { return s.id === id; });
    if (!session) return null;
    return JSON.stringify({
      exported: new Date().toISOString(),
      session: {
        name: session.name,
        messageCount: session.messageCount,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages
      }
    });
  }

  function importSession(jsonStr) {
    return SessionManager.importSession(jsonStr);
  }

  function search(query) {
    if (!query || typeof query !== 'string') return [];
    let q = query.toLowerCase();
    let sessions = SessionManager.getAll();
    return sessions.filter(function (s) {
      if (s.name && s.name.toLowerCase().indexOf(q) !== -1) return true;
      if (Array.isArray(s.messages)) {
        for (var i = 0; i < s.messages.length; i++) {
          if (s.messages[i].content && s.messages[i].content.toLowerCase().indexOf(q) !== -1) return true;
        }
      }
      return false;
    });
  }

  function getStats(id) {
    let sessions = SessionManager._loadAll();
    let session = sessions.find(function (s) { return s.id === id; });
    if (!session) return null;
    let msgs = session.messages || [];
    let wordCount = 0;
    msgs.forEach(function (m) {
      if (m.content && m.content.trim()) {
        wordCount += m.content.trim().split(/\s+/).length;
      }
    });
    return {
      messageCount: msgs.length,
      created: session.createdAt,
      lastModified: session.updatedAt,
      wordCount: wordCount
    };
  }

  function clear() {
    if (!_confirmPending) {
      _confirmPending = true;
      return false;
    }
    _confirmPending = false;
    SessionManager.clearAll();
    return true;
  }

  function resetConfirm() {
    _confirmPending = false;
  }

  function autoSave() {
    SessionManager.autoSaveIfEnabled();
  }

  function isOpen() {
    return SessionManager._isOpen ? SessionManager._isOpen() : false;
  }

  function open() {
    if (!isOpen()) SessionManager.toggle();
  }

  function close() {
    SessionManager.close();
  }

  return {
    save: save,
    load: load,
    rename: rename,
    'delete': deleteSession,
    list: list,
    getCurrent: getCurrent,
    exportSession: exportSession,
    importSession: importSession,
    search: search,
    getStats: getStats,
    clear: clear,
    resetConfirm: resetConfirm,
    autoSave: autoSave,
    isOpen: isOpen,
    open: open,
    close: close
  };
})();

/* ---------- Chat Statistics Dashboard ---------- */
/**
 * Conversation analytics dashboard with real-time statistics.
 *
 * Computes metrics from the current conversation: message counts, word counts
 * (user vs. assistant), average message length, code block count, estimated
 * token usage, and conversation duration. Renders the stats in a modal panel
 * with visual indicators for token budget utilization.
 *
 * @namespace ChatStats
 */
const ChatStats = (() => {
  let isOpen = false;

  const _cache = {};
  function el(id) {
    let node = _cache[id];
    if (!node) {
      node = document.getElementById(id);
      if (node) _cache[id] = node;
    }
    return node;
  }

  const _esc = _escapeHtml;

  /**
   * Compute statistics from current conversation messages.
   * Returns an object with computed stats.
   */
  function compute() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    const userMsgs = messages.filter(m => m.role === 'user');
    const assistantMsgs = messages.filter(m => m.role === 'assistant');

    // Word counts
    const wordCount = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;
    const totalUserWords = userMsgs.reduce((sum, m) => sum + wordCount(m.content), 0);
    const totalAssistantWords = assistantMsgs.reduce((sum, m) => sum + wordCount(m.content), 0);

    // Average message length (chars)
    const avgUserLen = userMsgs.length ? Math.round(userMsgs.reduce((s, m) => s + m.content.length, 0) / userMsgs.length) : 0;
    const avgAssistantLen = assistantMsgs.length ? Math.round(assistantMsgs.reduce((s, m) => s + m.content.length, 0) / assistantMsgs.length) : 0;

    // Code blocks (triple backtick)
    const codeBlockCount = messages.reduce((sum, m) => {
      const matches = m.content.match(/```/g);
      return sum + (matches ? Math.floor(matches.length / 2) : 0);
    }, 0);

    // Longest message
    let longestMsg = { role: 'none', length: 0, preview: '' };
    messages.forEach(m => {
      if (m.content.length > longestMsg.length) {
        longestMsg = {
          role: m.role,
          length: m.content.length,
          preview: m.content.substring(0, 80) + (m.content.length > 80 ? '…' : '')
        };
      }
    });

    // Question count (messages ending with ?)
    const questionCount = userMsgs.filter(m => m.content.trim().endsWith('?')).length;

    // Top words (excluding common stop words, from user messages)
    const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being',
      'have','has','had','do','does','did','will','would','could','should','may','might',
      'shall','can','to','of','in','for','on','with','at','by','from','as','into','through',
      'and','but','or','not','no','nor','so','yet','both','either','neither','i','me','my',
      'you','your','he','she','it','we','they','them','this','that','these','those','what',
      'which','who','how','if','then','than','when','where','there','here','all','each',
      'every','any','some','just','about','up','out','get','like','also','very','really']);
    const wordFreq = {};
    userMsgs.forEach(m => {
      m.content.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).forEach(w => {
        if (w.length > 2 && !stopWords.has(w)) {
          wordFreq[w] = (wordFreq[w] || 0) + 1;
        }
      });
    });
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    // Conversation ratio
    const ratio = userMsgs.length && assistantMsgs.length
      ? (totalAssistantWords / totalUserWords).toFixed(1)
      : '0';

    return {
      totalMessages: messages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      totalUserWords,
      totalAssistantWords,
      avgUserLen,
      avgAssistantLen,
      codeBlockCount,
      longestMsg,
      questionCount,
      topWords,
      responseRatio: ratio,
      responseTiming: (() => {
        const times = ConversationManager.getResponseTimes();
        if (times.length === 0) return null;
        const values = times.map(t => t.responseTimeMs);
        const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const total = values.reduce((a, b) => a + b, 0);
        return { count: values.length, avg, min, max, total };
      })(),
    };
  }

  /** Render the stats panel. */
  function render() {
    const existing = document.getElementById('stats-panel');
    if (existing) existing.remove();

    const stats = compute();
    const panel = document.createElement('div');
    panel.id = 'stats-panel';
    panel.className = 'stats-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat Statistics');

    // Top words as mini bar chart
    const maxCount = stats.topWords.length ? stats.topWords[0].count : 1;
    const topWordsHtml = stats.topWords.length
      ? stats.topWords.map(tw =>
          `<div class="stats-word-row">
            <span class="stats-word-label">${_esc(tw.word)}</span>
            <div class="stats-word-bar" style="width:${Math.max(8, (tw.count / maxCount) * 100)}%">${tw.count}</div>
          </div>`
        ).join('')
      : '<div class="stats-empty">No word data yet</div>';

    panel.innerHTML = `
      <div class="stats-header">
        <h3>📊 Chat Statistics</h3>
        <button class="stats-close" aria-label="Close statistics" title="Close">&times;</button>
      </div>
      <div class="stats-body">
        <div class="stats-grid">
          <div class="stats-card">
            <div class="stats-card-value">${stats.totalMessages}</div>
            <div class="stats-card-label">Total Messages</div>
          </div>
          <div class="stats-card">
            <div class="stats-card-value">${stats.userMessages}</div>
            <div class="stats-card-label">Your Messages</div>
          </div>
          <div class="stats-card">
            <div class="stats-card-value">${stats.assistantMessages}</div>
            <div class="stats-card-label">AI Responses</div>
          </div>
          <div class="stats-card">
            <div class="stats-card-value">${stats.codeBlockCount}</div>
            <div class="stats-card-label">Code Blocks</div>
          </div>
        </div>
        <div class="stats-section">
          <h4>💬 Message Analysis</h4>
          <div class="stats-row"><span>Your avg length:</span><span>${stats.avgUserLen} chars</span></div>
          <div class="stats-row"><span>AI avg length:</span><span>${stats.avgAssistantLen} chars</span></div>
          <div class="stats-row"><span>Questions asked:</span><span>${stats.questionCount}</span></div>
          <div class="stats-row"><span>Response ratio:</span><span>${stats.responseRatio}x</span></div>
          <div class="stats-row"><span>Your words:</span><span>${stats.totalUserWords}</span></div>
          <div class="stats-row"><span>AI words:</span><span>${stats.totalAssistantWords}</span></div>
        </div>
        ${stats.longestMsg.length > 0 ? `
        <div class="stats-section">
          <h4>📏 Longest Message</h4>
          <div class="stats-longest">
            <span class="stats-longest-role">${stats.longestMsg.role === 'user' ? 'You' : 'AI'}</span>
            <span class="stats-longest-len">${stats.longestMsg.length} chars</span>
          </div>
          <div class="stats-longest-preview">${stats.longestMsg.preview}</div>
        </div>` : ''}
        <div class="stats-section">
          <h4>🔤 Your Top Words</h4>
          <div class="stats-words">${topWordsHtml}</div>
        </div>
        ${stats.responseTiming ? `
        <div class="stats-section">
          <h4>⏱️ Response Times</h4>
          <div class="stats-row"><span>Responses tracked:</span><span>${stats.responseTiming.count}</span></div>
          <div class="stats-row"><span>Average:</span><span>${ResponseTimeBadge.formatTime(stats.responseTiming.avg)}</span></div>
          <div class="stats-row"><span>Fastest:</span><span class="rt-fast">${ResponseTimeBadge.formatTime(stats.responseTiming.min)}</span></div>
          <div class="stats-row"><span>Slowest:</span><span class="rt-slow">${ResponseTimeBadge.formatTime(stats.responseTiming.max)}</span></div>
          <div class="stats-row"><span>Total wait time:</span><span>${ResponseTimeBadge.formatTime(stats.responseTiming.total)}</span></div>
        </div>` : ''}
      </div>
    `;

    document.body.appendChild(panel);

    // Close button
    panel.querySelector('.stats-close').addEventListener('click', close);

    // Click outside to close
    const overlay = document.createElement('div');
    overlay.id = 'stats-overlay';
    overlay.className = 'stats-overlay';
    overlay.addEventListener('click', close);
    document.body.insertBefore(overlay, panel);

    isOpen = true;
  }

  function open() {
    if (!isOpen) render();
  }

  function close() {
    const panel = document.getElementById('stats-panel');
    const overlay = document.getElementById('stats-overlay');
    if (panel) panel.remove();
    if (overlay) overlay.remove();
    isOpen = false;
  }

  function toggle() {
    isOpen ? close() : open();
  }

  return { compute, render, open, close, toggle, isOpen: () => isOpen };
})();

/* ---------- Cost Dashboard ---------- */

/**
 * Persistent API spend tracker with cumulative totals, per-model
 * breakdown, daily trend chart, and configurable budget alerts.
 *
 * Every API response records { model, promptTokens, completionTokens,
 * cost, timestamp } in localStorage.  The dashboard visualises this
 * data and warns when spending crosses a user-set threshold.
 *
 * @namespace CostDashboard
 */
const CostDashboard = (() => {
  const STORAGE_KEY = 'agenticchat_cost_log';
  const BUDGET_KEY  = 'agenticchat_cost_budget';
  const MAX_ENTRIES = 5000; // cap stored entries to avoid quota issues

  let isOpen = false;

  /* ── Persistence helpers ─────────────────────────────────────── */

  /** Load cost log array from storage. */
  function _load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      return raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch (_) { return []; }
  }

  /** Persist cost log array. */
  function _save(log) {
    // Trim oldest entries if over cap
    if (log.length > MAX_ENTRIES) log = log.slice(log.length - MAX_ENTRIES);
    SafeStorage.set(STORAGE_KEY, JSON.stringify(log));
  }

  /** Get budget limit (USD) or null if not set. */
  function getBudget() {
    try {
      const v = SafeStorage.get(BUDGET_KEY);
      if (v === null || v === undefined) return null;
      const n = parseFloat(v);
      return isFinite(n) && n > 0 ? n : null;
    } catch (_) { return null; }
  }

  /** Set budget limit (pass null to clear). */
  function setBudget(usd) {
    if (usd === null || usd === undefined) {
      SafeStorage.remove(BUDGET_KEY);
    } else {
      SafeStorage.set(BUDGET_KEY, String(usd));
    }
  }

  /* ── Recording ───────────────────────────────────────────────── */

  /**
   * Record a single API response's token usage.
   * Called from ChatController after each successful API call.
   *
   * @param {Object} usage  – OpenAI usage object
   * @param {string} [model] – model name (defaults to ChatConfig.MODEL)
   */
  function recordUsage(usage, model) {
    if (!usage) return;
    const m = model || ChatConfig.MODEL || 'unknown';
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const pricing = ChatConfig.MODEL_PRICING[m] || [2.50, 10.00];
    const cost = (prompt * pricing[0] + completion * pricing[1]) / 1_000_000;

    const log = _load();
    log.push({
      ts: Date.now(),
      model: m,
      pt: prompt,
      ct: completion,
      cost: Math.round(cost * 1_000_000) / 1_000_000 // 6 decimal places
    });
    _save(log);

    // Check budget
    _checkBudgetAlert();
  }

  /* ── Budget alerts ───────────────────────────────────────────── */

  function _checkBudgetAlert() {
    const budget = getBudget();
    if (!budget) return;
    const totals = _computeTotals(_load());
    if (totals.totalCost >= budget) {
      _showBudgetWarning(totals.totalCost, budget);
    }
  }

  function _showBudgetWarning(spent, budget) {
    // Only show once per page load per threshold crossing
    if (_showBudgetWarning._shown) return;
    _showBudgetWarning._shown = true;
    const pct = Math.round((spent / budget) * 100);
    const bar = document.getElementById('token-usage');
    if (bar) {
      const warn = document.createElement('span');
      warn.className = 'cost-budget-warning';
      warn.textContent = ` ⚠️ Budget ${pct}% used ($${spent.toFixed(4)} / $${budget.toFixed(2)})`;
      bar.appendChild(warn);
    }
  }

  /* ── Computations ────────────────────────────────────────────── */

  function _computeTotals(log) {
    let totalCost = 0;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCalls = log.length;
    const byModel = {};
    const byDay = {};

    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      totalCost += e.cost;
      totalPrompt += e.pt;
      totalCompletion += e.ct;

      // Per-model
      if (!byModel[e.model]) {
        byModel[e.model] = { cost: 0, calls: 0, pt: 0, ct: 0 };
      }
      byModel[e.model].cost += e.cost;
      byModel[e.model].calls += 1;
      byModel[e.model].pt += e.pt;
      byModel[e.model].ct += e.ct;

      // Per-day
      const day = new Date(e.ts).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { cost: 0, calls: 0 };
      byDay[day].cost += e.cost;
      byDay[day].calls += 1;
    }

    return { totalCost, totalPrompt, totalCompletion, totalCalls, byModel, byDay };
  }

  /* ── Rendering ───────────────────────────────────────────────── */

  const _esc = _escapeHtml;


  function _fmtCost(n) {
    if (n < 0.01) return '$' + n.toFixed(6);
    if (n < 1) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }

  function _fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  /** Build the daily spending sparkline bar chart (last 14 days). */
  function _renderDailyChart(byDay) {
    const today = new Date();
    const days = [];
    for (let d = 13; d >= 0; d--) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      const key = dt.toISOString().slice(0, 10);
      days.push({ key, label: dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cost: (byDay[key] || {}).cost || 0 });
    }
    const maxCost = Math.max(...days.map(d => d.cost), 0.000001);

    let bars = '';
    for (let i = 0; i < days.length; i++) {
      const pct = Math.round((days[i].cost / maxCost) * 100);
      const costStr = _fmtCost(days[i].cost);
      bars += `<div class="cost-bar-col" title="${_esc(days[i].label)}: ${costStr}">` +
        `<div class="cost-bar" style="height:${Math.max(pct, 2)}%"></div>` +
        `<div class="cost-bar-label">${_esc(days[i].label.split(' ')[1] || days[i].label)}</div>` +
        `</div>`;
    }
    return `<div class="cost-chart">${bars}</div>`;
  }

  /** Render per-model breakdown table. */
  function _renderModelTable(byModel) {
    const models = Object.keys(byModel).sort((a, b) => byModel[b].cost - byModel[a].cost);
    if (models.length === 0) return '<p class="cost-empty">No data yet</p>';

    let rows = '';
    for (let i = 0; i < models.length; i++) {
      const m = byModel[models[i]];
      rows += `<tr>` +
        `<td class="cost-model-name">${_esc(models[i])}</td>` +
        `<td>${m.calls}</td>` +
        `<td>${_fmtTokens(m.pt)}</td>` +
        `<td>${_fmtTokens(m.ct)}</td>` +
        `<td class="cost-amount">${_fmtCost(m.cost)}</td>` +
        `</tr>`;
    }

    return `<table class="cost-table">` +
      `<thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `</table>`;
  }

  function render() {
    close(); // Remove existing

    const log = _load();
    const totals = _computeTotals(log);
    const budget = getBudget();

    const panel = document.createElement('div');
    panel.id = 'cost-panel';
    panel.className = 'cost-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Cost Dashboard');

    const budgetHtml = budget
      ? `<div class="cost-budget-bar">` +
        `<div class="cost-budget-fill" style="width:${Math.min(100, Math.round((totals.totalCost / budget) * 100))}%"></div>` +
        `<span class="cost-budget-text">${_fmtCost(totals.totalCost)} / ${_fmtCost(budget)} (${Math.round((totals.totalCost / budget) * 100)}%)</span>` +
        `</div>`
      : '';

    const avgCostPerCall = totals.totalCalls > 0 ? totals.totalCost / totals.totalCalls : 0;

    panel.innerHTML = `
      <div class="cost-header">
        <h3>💰 Cost Dashboard</h3>
        <div>
          <button class="cost-budget-btn btn-sm" title="Set budget limit">🎯 Budget</button>
          <button class="cost-export-btn btn-sm" title="Export cost data as CSV">📥 Export</button>
          <button class="cost-reset-btn btn-sm btn-danger-sm" title="Reset all cost data">🗑️</button>
          <button class="cost-close btn-sm" title="Close">✕</button>
        </div>
      </div>
      ${budgetHtml}
      <div class="cost-summary">
        <div class="cost-stat">
          <div class="cost-stat-value">${_fmtCost(totals.totalCost)}</div>
          <div class="cost-stat-label">Total Spent</div>
        </div>
        <div class="cost-stat">
          <div class="cost-stat-value">${totals.totalCalls}</div>
          <div class="cost-stat-label">API Calls</div>
        </div>
        <div class="cost-stat">
          <div class="cost-stat-value">${_fmtTokens(totals.totalPrompt + totals.totalCompletion)}</div>
          <div class="cost-stat-label">Total Tokens</div>
        </div>
        <div class="cost-stat">
          <div class="cost-stat-value">${_fmtCost(avgCostPerCall)}</div>
          <div class="cost-stat-label">Avg / Call</div>
        </div>
      </div>
      <div class="cost-section">
        <h4>📊 Daily Spending (14 days)</h4>
        ${_renderDailyChart(totals.byDay)}
      </div>
      <div class="cost-section">
        <h4>🤖 By Model</h4>
        ${_renderModelTable(totals.byModel)}
      </div>
    `;

    document.body.appendChild(panel);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'cost-overlay';
    overlay.className = 'cost-overlay';
    overlay.addEventListener('click', close);
    document.body.insertBefore(overlay, panel);

    // Wire buttons
    panel.querySelector('.cost-close').addEventListener('click', close);
    panel.querySelector('.cost-reset-btn').addEventListener('click', () => {
      if (confirm('Reset all cost tracking data? This cannot be undone.')) {
        _save([]);
        _showBudgetWarning._shown = false;
        render(); // re-render with empty data
      }
    });
    panel.querySelector('.cost-budget-btn').addEventListener('click', () => {
      const current = getBudget();
      const input = prompt(
        'Set monthly budget limit (USD).\nEnter a number or leave blank to clear:',
        current !== null ? current.toString() : ''
      );
      if (input === null) return; // cancelled
      if (input.trim() === '') {
        setBudget(null);
      } else {
        const val = parseFloat(input);
        if (isFinite(val) && val > 0) {
          setBudget(val);
        } else {
          alert('Please enter a positive number.');
          return;
        }
      }
      _showBudgetWarning._shown = false;
      render(); // re-render with updated budget
    });
    panel.querySelector('.cost-export-btn').addEventListener('click', _exportCSV);

    isOpen = true;
  }

  /* ── Export ──────────────────────────────────────────────────── */

  function _exportCSV() {
    const log = _load();
    if (log.length === 0) { alert('No cost data to export.'); return; }
    const header = 'timestamp,model,prompt_tokens,completion_tokens,cost_usd\n';
    const rows = log.map(e =>
      `${new Date(e.ts).toISOString()},${e.model},${e.pt},${e.ct},${e.cost.toFixed(6)}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agenticchat-costs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function open()   { if (!isOpen) render(); }
  function close()  {
    const panel = document.getElementById('cost-panel');
    const overlay = document.getElementById('cost-overlay');
    if (panel) panel.remove();
    if (overlay) overlay.remove();
    isOpen = false;
  }
  function toggle() { isOpen ? close() : open(); }

  /** Get totals for external use (e.g. tests). */
  function getTotals() { return _computeTotals(_load()); }

  /** Get raw log for testing. */
  function getLog() { return _load(); }

  /** Clear all data (for testing). */
  function reset() { _save([]); _showBudgetWarning._shown = false; }

  return {
    recordUsage, getBudget, setBudget, getTotals, getLog, reset,
    render, open, close, toggle, isOpen: () => isOpen
  };
})();

/* ---------- Persona / System Prompt Presets ---------- */

/**
 * Manages switchable system prompt presets (personas).
 * Users can pick from built-in presets or define a custom system prompt.
 * The active persona persists in localStorage.
 */
const PersonaPresets = (() => {
  const STORAGE_KEY = 'agenticchat_persona';
  let isOpen = false;

  const _esc = _escapeHtml;


  const presets = [
    {
      id: 'default',
      name: '🤖 Code Generator',
      desc: 'Default — replies with executable JavaScript code blocks.',
      prompt: ChatConfig.SYSTEM_PROMPT
    },
    {
      id: 'analyst',
      name: '📊 Data Analyst',
      desc: 'Generates data analysis, charts, and visualizations in JS.',
      prompt: 'You are a data analyst agent in a browser. Reply only with JavaScript code in a single code block that processes, analyzes, or visualizes data. Use canvas or DOM manipulation for charts. Always `return` the final value.'
    },
    {
      id: 'creative',
      name: '🎨 Creative Designer',
      desc: 'Generates interactive visual art, animations, and creative demos.',
      prompt: 'You are a creative coding agent in a browser. Reply only with JavaScript code in a single code block that creates beautiful visual art, animations, or interactive demos using canvas, SVG, or DOM manipulation. Be creative and visually impressive. Always `return` the final value.'
    },
    {
      id: 'teacher',
      name: '📚 Code Teacher',
      desc: 'Generates well-commented educational code with explanations.',
      prompt: 'You are a patient code teacher agent in a browser. Reply only with JavaScript code in a single code block. Add detailed comments explaining every step and concept. Include console.log statements showing intermediate values. Code should be educational and easy to follow. Always `return` the final value.'
    },
    {
      id: 'game',
      name: '🎮 Game Developer',
      desc: 'Builds interactive browser games using canvas and DOM.',
      prompt: 'You are a game development agent in a browser. Reply only with JavaScript code in a single code block that creates playable browser games using canvas or DOM elements. Games should be interactive with keyboard/mouse input, scoring, and game states. Always `return` the final value.'
    },
    {
      id: 'scraper',
      name: '🕷️ Web Utility',
      desc: 'Builds web utilities — converters, generators, calculators.',
      prompt: 'You are a utility-building agent in a browser. Reply only with JavaScript code in a single code block that creates useful web utilities: converters, generators, calculators, formatters, validators, etc. Build a complete interactive UI with inputs and outputs. Always `return` the final value.'
    },
    {
      id: 'minimal',
      name: '⚡ Minimal',
      desc: 'Concise code with no comments — just clean, working JS.',
      prompt: 'You are a minimalist coding agent in a browser. Reply only with JavaScript in a single code block. Write the shortest, cleanest code possible. No comments. No explanations. Just working code. Always `return` the final value.'
    }
  ];

  function getActiveId() {
    try {
      const saved = SafeStorage.get(STORAGE_KEY);
      if (saved) {
        const parsed = sanitizeStorageObject(JSON.parse(saved));
        return parsed.id || 'default';
      }
    } catch (_) {}
    return 'default';
  }

  function getActivePrompt() {
    try {
      const saved = SafeStorage.get(STORAGE_KEY);
      if (saved) {
        const parsed = sanitizeStorageObject(JSON.parse(saved));
        if (parsed.id === 'custom') return parsed.prompt || ChatConfig.SYSTEM_PROMPT;
        const preset = presets.find(p => p.id === parsed.id);
        return preset ? preset.prompt : ChatConfig.SYSTEM_PROMPT;
      }
    } catch (_) {}
    return ChatConfig.SYSTEM_PROMPT;
  }

  function save(id, customPrompt) {
    const data = { id };
    if (id === 'custom' && customPrompt) data.prompt = customPrompt;
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function applyPrompt(prompt) {
    ConversationManager.setSystemPrompt(prompt);
  }

  function selectPreset(id) {
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    save(id);
    applyPrompt(preset.prompt);
    render();
  }

  function applyCustom() {
    const textarea = document.getElementById('persona-custom-input');
    const prompt = (textarea.value || '').trim();
    if (!prompt) return;
    save('custom', prompt);
    applyPrompt(prompt);
    render();
  }

  function render() {
    const activeId = getActiveId();
    const activeEl = document.getElementById('persona-active');
    const listEl = document.getElementById('persona-list');

    if (activeId === 'custom') {
      activeEl.textContent = 'Active: Custom Prompt';
    } else {
      const active = presets.find(p => p.id === activeId);
      activeEl.textContent = active ? 'Active: ' + active.name : 'Active: Unknown';
    }

    listEl.innerHTML = presets.map(p => {
      const isActive = p.id === activeId;
      return '<div class="persona-card' + (isActive ? ' active' : '') + '" data-persona-id="' + _esc(p.id) + '">'
        + '<div class="persona-card-title">' + _esc(p.name) + (isActive ? ' ✓' : '') + '</div>'
        + '<div class="persona-card-desc">' + _esc(p.desc) + '</div>'
        + '</div>';
    }).join('');

    // Add custom card
    const isCustom = activeId === 'custom';
    listEl.innerHTML += '<div class="persona-card' + (isCustom ? ' active' : '') + '" data-persona-id="custom">'
      + '<div class="persona-card-title">✏️ Custom' + (isCustom ? ' ✓' : '') + '</div>'
      + '<div class="persona-card-desc">Use the custom prompt below.</div>'
      + '</div>';

    // Bind click handlers
    listEl.querySelectorAll('.persona-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-persona-id');
        if (id === 'custom') {
          applyCustom();
        } else {
          selectPreset(id);
        }
      });
    });
  }

  function open() {
    isOpen = true;
    document.getElementById('persona-panel').classList.add('open');
    document.getElementById('persona-overlay').classList.add('open');
    render();
  }

  function close() {
    isOpen = false;
    document.getElementById('persona-panel').classList.remove('open');
    document.getElementById('persona-overlay').classList.remove('open');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  /** Restore saved persona on startup. */
  function init() {
    const prompt = getActivePrompt();
    applyPrompt(prompt);
  }

  return { open, close, toggle, init, render, applyCustom, isOpen: () => isOpen };
})();

/* ---------- Model Selector ---------- */
/**
 * Lets users pick which OpenAI model to use for chat completions.
 * Selection persists in localStorage via ChatConfig.MODEL setter.
 */
const ModelSelector = (() => {
  let open = false;

  function _render() {
    const list = document.getElementById('model-list');
    if (!list) return;
    list.innerHTML = '';
    ChatConfig.AVAILABLE_MODELS.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'model-option' + (m.id === ChatConfig.MODEL ? ' model-active' : '');
      btn.textContent = m.label;
      btn.title = m.id;
      btn.addEventListener('click', () => {
        ChatConfig.MODEL = m.id;
        const label = document.getElementById('model-label');
        if (label) label.textContent = m.label;
        _render();
        close();
      });
      list.appendChild(btn);
    });
  }

  function toggle() {
    open ? close() : _open();
  }

  function _open() {
    open = true;
    const panel = document.getElementById('model-panel');
    const overlay = document.getElementById('model-overlay');
    if (panel) { panel.style.display = 'block'; }
    if (overlay) { overlay.style.display = 'block'; }
    _render();
  }

  function close() {
    open = false;
    const panel = document.getElementById('model-panel');
    const overlay = document.getElementById('model-overlay');
    if (panel) { panel.style.display = 'none'; }
    if (overlay) { overlay.style.display = 'none'; }
  }

  function init() {
    // Set initial label from saved model
    const saved = ChatConfig.MODEL;
    const match = ChatConfig.AVAILABLE_MODELS.find(m => m.id === saved);
    const label = document.getElementById('model-label');
    if (label && match) label.textContent = match.label;
  }

  return { toggle, close, init };
})();

/* ---------- File Drop Zone ---------- */
/**
 * Drag-and-drop file input for including file contents in chat prompts.
 *
 * Users can drag text-based files (.txt, .json, .csv, .js, .py, .md, .html,
 * .css, .xml, .yaml, .yml, .toml, .ini, .cfg, .log, .sql, .sh, .bat, .ps1,
 * .ts, .tsx, .jsx, .rs, .go, .java, .c, .cpp, .h, .rb, .php, .swift, .kt)
 * onto the chat area. The file contents are inserted into the chat input
 * wrapped in a code block with the filename. Multiple files are supported.
 *
 * Maximum file size: 100 KB per file, 5 files per drop.
 *
 * @namespace FileDropZone
 */
const FileDropZone = (() => {
  const MAX_FILE_SIZE = 100 * 1024; // 100 KB
  const MAX_FILES = 5;
  let dragCounter = 0;

  const TEXT_EXTENSIONS = new Set([
    'txt', 'json', 'csv', 'js', 'jsx', 'ts', 'tsx', 'py', 'md', 'html',
    'htm', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log',
    'sql', 'sh', 'bat', 'ps1', 'rs', 'go', 'java', 'c', 'cpp', 'h',
    'hpp', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'r', 'lua',
    'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'ml', 'mli', 'fs', 'fsx',
    'clj', 'cljs', 'lisp', 'el', 'vim', 'diff', 'patch', 'env',
    'gitignore', 'dockerignore', 'editorconfig', 'prettierrc',
    'eslintrc', 'babelrc', 'tsconfig', 'svg', 'tex', 'bib', 'rst',
    'adoc', 'org', 'makefile', 'cmake', 'gradle', 'sbt', 'cabal',
    'lock', 'sum', 'mod', 'csproj', 'sln', 'vcxproj', 'pom',
    'properties', 'conf', 'rc', 'srv'
  ]);

  /** Map common extensions to markdown code fence language hints. */
  function _langHint(ext) {
    const map = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
      c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
      swift: 'swift', kt: 'kotlin', scala: 'scala', r: 'r',
      sh: 'bash', bat: 'batch', ps1: 'powershell',
      sql: 'sql', html: 'html', htm: 'html', css: 'css',
      xml: 'xml', svg: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml',
      toml: 'toml', md: 'markdown', tex: 'latex',
      lua: 'lua', pl: 'perl', php: 'php', ex: 'elixir',
      hs: 'haskell', ml: 'ocaml', fs: 'fsharp', clj: 'clojure',
      lisp: 'lisp', diff: 'diff', csv: 'csv', srv: 'sauravcode'
    };
    return map[ext] || '';
  }

  /** Check if a filename has a supported text extension. */
  function isTextFile(filename) {
    if (!filename) return false;
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx < 0) {
      // Files without extensions — check common names
      const lower = filename.toLowerCase();
      return ['makefile', 'dockerfile', 'rakefile', 'gemfile', 'procfile',
              'vagrantfile', 'readme', 'license', 'changelog', 'authors',
              'contributing', 'todo', 'notes'].includes(lower);
    }
    const ext = filename.substring(dotIdx + 1).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
  }

  /** Get file extension (lowercase, no dot). */
  function _getExt(filename) {
    const dotIdx = filename.lastIndexOf('.');
    return dotIdx >= 0 ? filename.substring(dotIdx + 1).toLowerCase() : '';
  }

  /** Show the drop overlay. */
  function _showOverlay() {
    const overlay = document.getElementById('file-drop-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  /** Hide the drop overlay. */
  function _hideOverlay() {
    const overlay = document.getElementById('file-drop-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  /** Read a File as text, with size validation. Returns a Promise. */
  function _readFile(file) {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_FILE_SIZE) {
        reject(new Error(`File "${file.name}" is too large (${Math.round(file.size / 1024)} KB). Max: ${MAX_FILE_SIZE / 1024} KB.`));
        return;
      }
      if (!isTextFile(file.name)) {
        reject(new Error(`File "${file.name}" is not a supported text file type.`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, content: reader.result });
      reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
      reader.readAsText(file);
    });
  }

  /** Process dropped files and insert into chat input. */
  async function _handleFiles(files) {
    if (files.length === 0) return;

    const toProcess = Array.from(files).slice(0, MAX_FILES);
    const results = [];
    const errors = [];

    for (const file of toProcess) {
      try {
        const result = await _readFile(file);
        results.push(result);
      } catch (e) {
        errors.push(e.message);
      }
    }

    if (files.length > MAX_FILES) {
      errors.push(`Only the first ${MAX_FILES} files were processed (${files.length} dropped).`);
    }

    if (errors.length > 0) {
      UIController.setConsoleOutput('⚠️ ' + errors.join(' | '), '#f59e0b');
    }

    if (results.length === 0) return;

    // Build the text to insert into the chat input
    const input = document.getElementById('chat-input');
    if (!input) return;

    const existing = input.value;
    const parts = [];

    for (const { name, content } of results) {
      const ext = _getExt(name);
      const lang = _langHint(ext);
      parts.push(`📎 **${name}**\n\`\`\`${lang}\n${content}\n\`\`\``);
    }

    const fileText = parts.join('\n\n');
    const separator = existing.trim() ? '\n\n' : '';
    input.value = existing + separator + fileText;
    input.focus();
    UIController.updateCharCount(input.value.length);

    // Brief confirmation
    const count = results.length;
    const msg = `📎 ${count} file${count > 1 ? 's' : ''} added to input`;
    const consoleOut = document.getElementById('console-output');
    if (consoleOut && errors.length === 0) {
      consoleOut.textContent = msg;
      consoleOut.style.color = '#4ade80';
    }
  }

  /** Initialize drag-and-drop event listeners. */
  function init() {
    const blackbox = document.getElementById('blackbox');
    if (!blackbox) return;

    // Use dragCounter to handle nested element drag enter/leave correctly
    blackbox.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (dragCounter === 1) _showOverlay();
    });

    blackbox.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) _hideOverlay();
    });

    blackbox.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });

    blackbox.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      _hideOverlay();

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        _handleFiles(files);
      }
    });
  }

  return {
    init,
    isTextFile,
    handleFiles: _handleFiles,
    MAX_FILE_SIZE,
    MAX_FILES,
    _langHint,
    _getExt,
    _handleFiles
  };
})();

/* ---------- Focus / Zen Mode ---------- */
/**
 * FocusMode — distraction-free chat mode.
 *
 * Hides non-essential toolbar buttons, the API key bar, title, char count,
 * and token usage to let the user focus purely on the conversation.
 * Toggled via Ctrl+Shift+F, the 🧘 button, or the /focus slash command.
 * State persists across page reloads via localStorage.
 *
 * @namespace FocusMode
 */
const FocusMode = (() => {
  const STORAGE_KEY = 'ac-focus-mode';
  let active = JSON.parse(SafeStorage.get(STORAGE_KEY) || 'false');

  function apply() {
    document.body.classList.toggle('zen-mode', active);
    const btn = document.getElementById('zen-btn');
    if (btn) {
      btn.classList.toggle('active', active);
      btn.title = active
        ? 'Exit focus mode (Ctrl+Shift+F)'
        : 'Focus mode — hide distractions (Ctrl+Shift+F)';
    }
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(active)); } catch (_) {}
  }

  function toggle() {
    active = !active;
    apply();
    return active;
  }

  function init() {
    apply();
    // Global shortcut: Ctrl+Shift+F
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        toggle();
      }
      // Escape exits focus mode
      if (e.key === 'Escape' && active) {
        // Only exit if no modal/panel is open
        const anyPanelOpen = document.querySelector(
          '#history-panel[style*="display: flex"], #templates-panel[style*="display: flex"], ' +
          '#snippets-panel[style*="display: flex"], #sessions-panel[style*="display: flex"], ' +
          '#shortcuts-modal[style*="display: flex"], #persona-panel[style*="display: flex"]'
        );
        if (!anyPanelOpen) {
          toggle();
        }
      }
    });
  }

  return { init, toggle, isActive: () => active };
})();

/* ============================================================
 * InputHistory — navigate previous prompts with ↑/↓ arrows.
 *
 * Records every user prompt sent via ChatController.send().
 * Persists in localStorage so history survives page reloads.
 * Up/Down arrows cycle through history when the chat input
 * is focused and the cursor is at position 0 (Up) or at
 * the end (Down).  Typing resets navigation to the draft.
 *
 * @namespace InputHistory
 * ============================================================ */
const InputHistory = (() => {
  const STORAGE_KEY = 'ac-input-history';
  const MAX_ENTRIES = 100;

  let entries = [];        // oldest-first: entries[0] = oldest
  let cursor  = -1;        // -1 = not navigating (typing new text)
  let draft   = '';        // saved current input while navigating

  /** Load history from localStorage. */
  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) {
        const parsed = sanitizeStorageObject(JSON.parse(raw));
        if (Array.isArray(parsed)) {
          entries = parsed.slice(-MAX_ENTRIES);
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  /** Save history to localStorage. */
  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch { /* quota exceeded — silently drop */ }
  }

  /**
   * Record a prompt.  Deduplicates consecutive identical entries.
   * @param {string} text
   */
  function push(text) {
    if (!text) return;
    // Avoid consecutive dupes
    if (entries.length > 0 && entries[entries.length - 1] === text) {
      resetCursor();
      return;
    }
    entries.push(text);
    if (entries.length > MAX_ENTRIES) entries.shift();
    save();
    resetCursor();
  }

  /** Reset navigation state (called after send or when user types). */
  function resetCursor() {
    cursor = -1;
    draft = '';
  }

  /**
   * Handle keydown on the chat input for Up/Down navigation.
   * Returns true if the event was consumed (caller should preventDefault).
   * @param {KeyboardEvent} e
   * @param {HTMLInputElement} input
   * @returns {boolean}
   */
  function handleKeydown(e, input) {
    if (entries.length === 0) return false;

    if (e.key === 'ArrowUp') {
      // Only activate when cursor is at position 0 (or input is empty)
      if (input.selectionStart !== 0 && input.value.length > 0) return false;

      if (cursor === -1) {
        // Starting navigation — save current draft
        draft = input.value;
        cursor = entries.length - 1;
      } else if (cursor > 0) {
        cursor--;
      } else {
        // Already at oldest — do nothing
        return true;
      }
      input.value = entries[cursor];
      UIController.updateCharCount(input.value.length);
      // Move cursor to end of input
      setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
      return true;
    }

    if (e.key === 'ArrowDown') {
      if (cursor === -1) return false; // Not navigating

      if (cursor < entries.length - 1) {
        cursor++;
        input.value = entries[cursor];
      } else {
        // Past newest — restore draft
        cursor = -1;
        input.value = draft;
        draft = '';
      }
      UIController.updateCharCount(input.value.length);
      setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
      return true;
    }

    return false;
  }

  /** Get all history entries (for testing/export). */
  function getAll() { return entries.slice(); }

  /** Get current entry count. */
  function getCount() { return entries.length; }

  /** Clear all history. */
  function clearAll() {
    entries = [];
    cursor = -1;
    draft = '';
    try { SafeStorage.remove(STORAGE_KEY); } catch { /* */ }
  }

  // Load on module init
  load();

  return {
    push,
    resetCursor,
    handleKeydown,
    getAll,
    getCount,
    clearAll
  };
})();

/* ---------- Scratchpad ---------- */
/**
 * Persistent notepad panel for jotting down ideas while chatting.
 * Notes auto-save to localStorage on every keystroke (debounced).
 * Supports copy, insert-to-chat, download, and clear actions.
 *
 * @namespace Scratchpad
 */
const Scratchpad = (() => {
  const STORAGE_KEY = 'agenticchat_scratchpad';
  let isOpen = false;
  let saveTimer = null;

  /** Load notes from localStorage. */
  function _load() {
    try { return SafeStorage.get(STORAGE_KEY) || ''; } catch { return ''; }
  }

  /** Save notes to localStorage. */
  function _save(text) {
    try { SafeStorage.set(STORAGE_KEY, text); } catch {}
  }

  /** Update the word/char count display. */
  function _updateCount() {
    const textarea = document.getElementById('scratchpad-textarea');
    const countEl = document.getElementById('scratchpad-wordcount');
    if (!textarea || !countEl) return;
    const text = textarea.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = textarea.value.length;
    countEl.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
  }

  /** Show a brief status message. */
  function _showStatus(msg) {
    const el = document.getElementById('scratchpad-status');
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2000);
  }

  /** Auto-save with debounce. */
  function _onInput() {
    _updateCount();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const textarea = document.getElementById('scratchpad-textarea');
      if (textarea) _save(textarea.value);
    }, 300);
  }

  /** Copy notes to clipboard. */
  function copy() {
    const textarea = document.getElementById('scratchpad-textarea');
    if (!textarea || !textarea.value.trim()) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
      _showStatus('Copied!');
    }).catch(() => {
      textarea.select();
      document.execCommand('copy');
      _showStatus('Copied!');
    });
  }

  /** Insert notes into the chat input. */
  function insertToChat() {
    const textarea = document.getElementById('scratchpad-textarea');
    const chatInput = document.getElementById('chat-input');
    if (!textarea || !chatInput || !textarea.value.trim()) return;
    const existing = chatInput.value;
    const sep = existing.trim() ? '\n' : '';
    chatInput.value = existing + sep + textarea.value;
    UIController.updateCharCount(chatInput.value.length);
    chatInput.focus();
    _showStatus('Inserted!');
  }

  /** Download notes as a .txt file. */
  function download() {
    const textarea = document.getElementById('scratchpad-textarea');
    if (!textarea || !textarea.value.trim()) return;
    const blob = new Blob([textarea.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scratchpad-notes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _showStatus('Downloaded!');
  }

  /** Clear all notes. */
  function clear() {
    const textarea = document.getElementById('scratchpad-textarea');
    if (!textarea) return;
    if (!textarea.value.trim()) return;
    if (!confirm('Clear all scratchpad notes?')) return;
    textarea.value = '';
    _save('');
    _updateCount();
    _showStatus('Cleared');
  }

  /** Open the panel. */
  function open() {
    isOpen = true;
    const panel = document.getElementById('scratchpad-panel');
    const overlay = document.getElementById('scratchpad-overlay');
    const textarea = document.getElementById('scratchpad-textarea');
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
    if (textarea) {
      textarea.value = _load();
      textarea.focus();
      _updateCount();
    }
  }

  /** Close the panel. */
  function close() {
    isOpen = false;
    const panel = document.getElementById('scratchpad-panel');
    const overlay = document.getElementById('scratchpad-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    // Save on close
    const textarea = document.getElementById('scratchpad-textarea');
    if (textarea) _save(textarea.value);
  }

  /** Toggle the panel. */
  function toggle() {
    isOpen ? close() : open();
  }

  return { open, close, toggle, copy, insertToChat, download, clear, _onInput, isOpen: () => isOpen };
})();

/* ---------- Response Time Badge ---------- */
/**
 * Displays response time badge after each AI response.
 * Shows a small, non-intrusive timing indicator below the token usage area.
 * Formats time as ms or seconds depending on magnitude.
 *
 * @namespace ResponseTimeBadge
 */
const ResponseTimeBadge = (() => {
  function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function show(responseTimeMs) {
    if (!ConversationManager.isTimingVisible()) return;

    // Remove any existing badge
    const existing = document.getElementById('response-time-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.id = 'response-time-badge';
    badge.className = 'response-time-badge';
    badge.title = `Response completed in ${responseTimeMs.toLocaleString()}ms`;

    // Color code: green < 3s, yellow < 8s, red >= 8s
    let colorClass = 'rt-fast';
    if (responseTimeMs >= 8000) colorClass = 'rt-slow';
    else if (responseTimeMs >= 3000) colorClass = 'rt-medium';

    badge.innerHTML = `<span class="rt-icon">⏱️</span> <span class="rt-value ${colorClass}">${formatTime(responseTimeMs)}</span>`;

    // Insert after token-usage div
    const tokenUsage = document.getElementById('token-usage');
    if (tokenUsage) {
      tokenUsage.parentNode.insertBefore(badge, tokenUsage.nextSibling);
    } else {
      const blackbox = document.getElementById('blackbox');
      if (blackbox) blackbox.appendChild(badge);
    }

    // Fade in
    requestAnimationFrame(() => badge.classList.add('rt-visible'));
  }

  function hide() {
    const existing = document.getElementById('response-time-badge');
    if (existing) existing.remove();
  }

  return { show, hide, formatTime };
})();

/* ---------- Conversation Fork ---------- */
/**
 * Conversation forking — branch a chat from any message point.
 *
 * Adds a "Fork" button to each message in the history panel. Clicking it
 * creates a new session containing all messages up to (and including) the
 * selected message, then loads the fork so the user can continue the
 * conversation along a different path. Useful for exploring alternative
 * approaches without losing the original thread.
 *
 * The forked session is named "Fork of <original> @ msg #N" and can be
 * managed like any other session (rename, delete, export).
 *
 * @namespace ConversationFork
 */
const ConversationFork = (() => {

  /**
   * Fork the conversation at a given message index.
   *
   * @param {number} historyIndex — index into ConversationManager.getHistory()
   *   (includes the system message at index 0)
   * @returns {object|null} the newly created session, or null on failure
   */
  function forkAt(historyIndex) {
    const history = ConversationManager.getHistory();
    if (historyIndex < 1 || historyIndex >= history.length) return null;

    // Collect messages from index 1 (skip system) through historyIndex
    const forkedMessages = [];
    for (let i = 1; i <= historyIndex; i++) {
      const m = history[i];
      if (m.role === 'user' || m.role === 'assistant') {
        forkedMessages.push({ role: m.role, content: m.content });
      }
    }
    if (forkedMessages.length === 0) return null;

    // Save current session first (auto-save)
    SessionManager.autoSaveIfEnabled();

    // Determine fork name
    const sessions = SessionManager.getAll();
    const activeId = SessionManager.getActiveId();
    const parentSession = activeId ? sessions.find(s => s.id === activeId) : null;
    const parentName = parentSession ? parentSession.name : 'Chat';
    // Count non-system messages up to historyIndex for human-friendly numbering
    let msgNumber = 0;
    for (let i = 1; i <= historyIndex; i++) {
      if (history[i].role !== 'system') msgNumber++;
    }
    const forkName = `Fork of ${_truncate(parentName, 30)} @ msg #${msgNumber}`;

    // Clear current conversation and load forked messages
    ConversationManager.clear();
    forkedMessages.forEach(m => ConversationManager.addMessage(m.role, m.content));

    // Save as a new session
    const newSession = SessionManager.save(forkName);

    // Update the UI
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt(`Forked: ${forkName}`);
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    HistoryPanel.refresh();

    // Show a brief notification
    _showForkNotification(forkName, forkedMessages.length);

    return newSession;
  }

  /**
   * Truncate a string with ellipsis.
   */
  function _truncate(str, max) {
    if (!str || str.length <= max) return str || '';
    return str.substring(0, max - 1) + '\u2026';
  }

  /**
   * Show a temporary notification when a fork is created.
   */
  function _showForkNotification(name, msgCount) {
    const note = document.createElement('div');
    note.className = 'fork-notification';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.innerHTML =
      '<span class="fork-notification-icon">\u2702\uFE0F</span> ' +
      '<span>Forked! <strong>' + _escapeHtml(name) + '</strong> ' +
      '(' + msgCount + ' message' + (msgCount !== 1 ? 's' : '') + ')</span>';
    document.body.appendChild(note);

    // Animate in
    requestAnimationFrame(() => note.classList.add('visible'));

    // Remove after 3 seconds
    setTimeout(() => {
      note.classList.remove('visible');
      setTimeout(() => note.remove(), 300);
    }, 3000);
  }

  // Uses the shared _escapeHtml defined at file scope (line ~213).

  /**
   * Decorate history panel messages with fork buttons.
   * Called after HistoryPanel.refresh() renders messages.
   */
  function decorateMessages() {
    const container = document.getElementById('history-messages');
    if (!container) return;
    const msgs = container.querySelectorAll('.history-msg');
    const history = ConversationManager.getHistory();

    let nonSystemIdx = 0;
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (nonSystemIdx < msgs.length) {
        _addForkButton(msgs[nonSystemIdx], i);
      }
      nonSystemIdx++;
    }
  }

  /**
   * Add a fork button to a message element.
   */
  function _addForkButton(messageElement, historyIndex) {
    // Don't add if already present
    if (messageElement.querySelector('.fork-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'fork-btn';
    btn.textContent = '\u2702\uFE0F Fork';
    btn.title = 'Fork conversation from this point \u2014 creates a new session with all messages up to here';
    btn.setAttribute('aria-label', 'Fork conversation from this message');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const result = forkAt(historyIndex);
      if (result) {
        // Close history panel to show the forked conversation
        HistoryPanel.close();
      }
    });

    messageElement.appendChild(btn);
  }

  return { forkAt, decorateMessages, decorateOne: _addForkButton };
})();

/* ---------- Quick Replies ---------- */
/**
 * Contextual quick-reply suggestion chips shown after AI responses.
 *
 * Analyzes the assistant's reply to determine whether it contains code,
 * explanations, errors, or other patterns and presents relevant follow-up
 * suggestions as clickable chips below the console output. Clicking a chip
 * inserts the suggestion into the chat input and optionally auto-sends it.
 *
 * @namespace QuickReplies
 */
const QuickReplies = (() => {
  const CODE_SUGGESTIONS = [
    { label: '🔍 Explain this code', prompt: 'Explain the code you just wrote step by step. What does each part do?' },
    { label: '⚡ Make it faster', prompt: 'Optimize the code you just wrote for better performance. Keep the same functionality.' },
    { label: '🛡️ Add error handling', prompt: 'Add proper error handling and edge-case checks to the code you just wrote.' },
    { label: '🎨 Improve the UI', prompt: 'Improve the visual design of the output — better colors, spacing, typography, and polish.' },
    { label: '➕ Add more features', prompt: 'Extend the code with additional useful features. Keep it clean and well-structured.' },
    { label: '📱 Make responsive', prompt: 'Make the output responsive so it looks good on mobile, tablet, and desktop.' },
    { label: '♿ Add accessibility', prompt: 'Add ARIA labels, keyboard navigation, and screen reader support to the code.' },
    { label: '💾 Add export', prompt: 'Add the ability to export or download the output as a file (e.g. PNG, CSV, JSON).' },
  ];

  const TEXT_SUGGESTIONS = [
    { label: '📝 Go deeper', prompt: 'Elaborate on your last response with more detail and examples.' },
    { label: '🔄 Try a different approach', prompt: 'Give me a completely different approach or perspective on this.' },
    { label: '💻 Show me the code', prompt: 'Write working code that demonstrates what you just described.' },
    { label: '📊 Compare alternatives', prompt: 'Compare the top alternatives or approaches with pros and cons.' },
  ];

  const ERROR_SUGGESTIONS = [
    { label: '🔧 Fix the error', prompt: 'The code had an error. Please fix it and explain what went wrong.' },
    { label: '🔄 Try a simpler approach', prompt: 'That approach had issues. Try a simpler, more reliable implementation.' },
    { label: '📖 Explain the error', prompt: 'Explain what caused the error and how to prevent it in the future.' },
  ];

  /**
   * Analyze the AI response and show relevant suggestion chips.
   * @param {string} reply      The full assistant reply text.
   * @param {boolean} hasCode   Whether the reply contained a code block.
   * @param {boolean} hadError  Whether the sandbox execution failed.
   */
  function show(reply, hasCode, hadError) {
    const container = document.getElementById('quick-replies');
    if (!container) return;

    let suggestions;
    if (hadError) {
      suggestions = ERROR_SUGGESTIONS;
    } else if (hasCode) {
      // Pick 4 random code suggestions to avoid overwhelming
      suggestions = _pickRandom(CODE_SUGGESTIONS, 4);
    } else {
      suggestions = TEXT_SUGGESTIONS;
    }

    _render(container, suggestions);
  }

  /** Hide the suggestion chips. */
  function hide() {
    const container = document.getElementById('quick-replies');
    if (container) {
      container.innerHTML = '';
      container.style.display = 'none';
    }
  }

  /**
   * Pick n random items from an array (Fisher-Yates partial shuffle).
   * @param {Array} arr  Source array.
   * @param {number} n   Number of items to pick.
   * @returns {Array}    Randomly selected items.
   */
  function _pickRandom(arr, n) {
    const copy = arr.slice();
    const result = [];
    const count = Math.min(n, copy.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  }

  /**
   * Render suggestion chips into the container.
   * @param {HTMLElement} container  The quick-replies container element.
   * @param {Array} suggestions     Array of { label, prompt } objects.
   */
  function _render(container, suggestions) {
    container.innerHTML = '';
    container.style.display = 'flex';

    suggestions.forEach(suggestion => {
      const chip = document.createElement('button');
      chip.className = 'quick-reply-chip';
      chip.textContent = suggestion.label;
      chip.title = suggestion.prompt;
      chip.addEventListener('click', () => _selectSuggestion(suggestion));
      container.appendChild(chip);
    });
  }

  /**
   * Handle chip click — insert prompt into chat input and focus.
   * @param {Object} suggestion  The selected { label, prompt } object.
   */
  function _selectSuggestion(suggestion) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = suggestion.prompt;
      input.focus();
      UIController.updateCharCount(suggestion.prompt.length);
    }
    hide();
  }

  return { show, hide };
})();

/* ---------- Event Bindings ---------- */
/* ── Message Pinning ── */
/**
 * Pin important messages to a floating bar at the top of the chat area.
 * Pinned messages persist in localStorage and provide quick-jump navigation.
 * Messages are identified by their index in the conversation history.
 *
 * @namespace MessagePinning
 */
const MessagePinning = (() => {
  const STORAGE_KEY = 'agenticchat_pins';
  const MAX_PINS = 20;

  // pins: array of { messageIndex, preview, role, pinnedAt }
  let pins = [];
  let barEl = null;
  let listEl = null;
  let collapsed = false;

  function init() {
    load();
    buildBar();
  }

  /** Build the floating pin bar (injected above chat-output). */
  function buildBar() {
    const output = document.getElementById('chat-output');
    if (!output || !output.parentNode) return;

    // Don't double-create
    if (document.getElementById('pin-bar')) return;

    barEl = document.createElement('div');
    barEl.id = 'pin-bar';
    barEl.setAttribute('role', 'region');
    barEl.setAttribute('aria-label', 'Pinned messages');
    barEl.style.cssText = 'display:none;background:#1a2332;border:1px solid #2d4a6f;border-radius:8px;padding:0;margin-bottom:8px;font-size:13px;max-height:200px;overflow:hidden;transition:max-height 0.2s ease';

    // Header with toggle + count + clear
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;user-select:none';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'true');
    header.tabIndex = 0;

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'color:#38bdf8;font-weight:600';
    titleSpan.id = 'pin-bar-title';
    titleSpan.textContent = '\uD83D\uDCCC Pinned';
    header.appendChild(titleSpan);

    const actions = document.createElement('span');

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear all';
    clearBtn.title = 'Unpin all messages';
    clearBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:11px;padding:2px 6px;margin-left:4px';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAll();
    });
    actions.appendChild(clearBtn);

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '\u25B2';
    collapseBtn.title = 'Collapse pinned messages';
    collapseBtn.id = 'pin-collapse-btn';
    collapseBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:11px;padding:2px 6px';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse();
    });
    actions.appendChild(collapseBtn);
    header.appendChild(actions);

    header.addEventListener('click', toggleCollapse);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse();
      }
    });

    barEl.appendChild(header);

    // Pin list
    listEl = document.createElement('ul');
    listEl.id = 'pin-list';
    listEl.style.cssText = 'list-style:none;padding:0;margin:0;max-height:150px;overflow-y:auto';
    barEl.appendChild(listEl);

    output.parentNode.insertBefore(barEl, output);
    renderBar();
  }

  /** Toggle collapsed state of the pin bar. */
  function toggleCollapse() {
    collapsed = !collapsed;
    const btn = document.getElementById('pin-collapse-btn');
    if (btn) btn.textContent = collapsed ? '\u25BC' : '\u25B2';
    if (listEl) listEl.style.display = collapsed ? 'none' : '';
    if (barEl) {
      const header = barEl.querySelector('[role="button"]');
      if (header) header.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  /** Pin a message by its conversation index. */
  function pin(messageIndex) {
    if (typeof messageIndex !== 'number' || messageIndex < 0) return false;
    if (pins.length >= MAX_PINS) return false;
    if (isPinned(messageIndex)) return false;

    const messages = ConversationManager.getMessages();
    if (messageIndex >= messages.length) return false;

    const msg = messages[messageIndex];
    if (msg.role === 'system') return false;

    const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');

    pins.push({
      messageIndex: messageIndex,
      preview: preview,
      role: msg.role,
      pinnedAt: Date.now()
    });

    save();
    renderBar();
    return true;
  }

  /** Unpin a message. */
  function unpin(messageIndex) {
    const idx = pins.findIndex(p => p.messageIndex === messageIndex);
    if (idx === -1) return false;

    pins.splice(idx, 1);
    save();
    renderBar();
    return true;
  }

  /** Toggle pin state. */
  function togglePin(messageIndex) {
    if (isPinned(messageIndex)) {
      return unpin(messageIndex);
    } else {
      return pin(messageIndex);
    }
  }

  /** Check if a message is pinned. */
  function isPinned(messageIndex) {
    return pins.some(p => p.messageIndex === messageIndex);
  }

  /** Get all pinned messages. */
  function getPins() {
    return pins.map(p => Object.assign({}, p));
  }

  /** Get count of pinned messages. */
  function getCount() {
    return pins.length;
  }

  /** Clear all pins. */
  function clearAll() {
    const count = pins.length;
    pins = [];
    save();
    renderBar();
    return count;
  }

  /** Jump to a pinned message in the chat output. */
  function jumpTo(messageIndex) {
    const output = document.getElementById('chat-output');
    if (!output) return;

    // Find the message element — messages are child divs of chat-output
    const allMsgs = output.querySelectorAll('.chat-msg');
    // Message index in conversation includes system prompt at [0],
    // but system msgs aren't rendered, so DOM index = messageIndex - 1
    const domIndex = messageIndex - 1;
    if (domIndex >= 0 && domIndex < allMsgs.length) {
      const target = allMsgs[domIndex];
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      const orig = target.style.outline;
      target.style.outline = '2px solid #38bdf8';
      target.style.outlineOffset = '2px';
      setTimeout(() => {
        target.style.outline = orig;
        target.style.outlineOffset = '';
      }, 1500);
    }
  }

  /** Render the floating pin bar. */
  function renderBar() {
    if (!barEl || !listEl) return;

    if (pins.length === 0) {
      barEl.style.display = 'none';
      return;
    }

    barEl.style.display = '';
    const title = document.getElementById('pin-bar-title');
    if (title) title.textContent = '\uD83D\uDCCC Pinned (' + pins.length + ')';

    // Clear and rebuild list
    listEl.textContent = '';

    pins.forEach(p => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:center;padding:4px 10px;border-top:1px solid #1e2d3d;cursor:pointer;transition:background 0.15s';

      li.addEventListener('mouseenter', () => { li.style.background = '#1e2d3d'; });
      li.addEventListener('mouseleave', () => { li.style.background = ''; });

      // Role icon
      const icon = document.createElement('span');
      icon.textContent = p.role === 'user' ? '\uD83D\uDC64' : '\uD83E\uDD16';
      icon.style.cssText = 'margin-right:6px;flex-shrink:0;font-size:12px';
      li.appendChild(icon);

      // Preview text
      const text = document.createElement('span');
      text.textContent = p.preview.length > 60 ? p.preview.substring(0, 60) + '\u2026' : p.preview;
      text.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;font-size:12px';
      li.appendChild(text);

      // Unpin button
      const unpinBtn = document.createElement('button');
      unpinBtn.textContent = '\u2716';
      unpinBtn.title = 'Unpin';
      unpinBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:2px 4px;margin-left:4px;flex-shrink:0';
      unpinBtn.setAttribute('aria-label', 'Unpin message');
      unpinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unpin(p.messageIndex);
      });
      li.appendChild(unpinBtn);

      // Click to jump
      li.addEventListener('click', () => jumpTo(p.messageIndex));
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', 'Jump to pinned message: ' + p.preview.substring(0, 40));
      li.tabIndex = 0;
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jumpTo(p.messageIndex);
        }
      });

      listEl.appendChild(li);
    });
  }

  /** Persist pins to localStorage. */
  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(pins));
    } catch (_) {
      // Storage full — degrade silently
    }
  }

  /** Load pins from localStorage. */
  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) {
        const parsed = sanitizeStorageObject(JSON.parse(raw));
        if (Array.isArray(parsed)) {
          pins = parsed.filter(p =>
            typeof p.messageIndex === 'number' &&
            typeof p.preview === 'string' &&
            typeof p.role === 'string'
          );
        }
      }
    } catch (_) {
      pins = [];
    }
  }

  /** Reset (for tests). */
  function reset() {
    pins = [];
    collapsed = false;
    if (barEl && barEl.parentNode) {
      barEl.parentNode.removeChild(barEl);
    }
    barEl = null;
    listEl = null;
    try { SafeStorage.remove(STORAGE_KEY); } catch (_) {}
  }

  return {
    init, pin, unpin, togglePin, isPinned,
    getPins, getCount, clearAll, jumpTo,
    renderBar, reset, toggleCollapse
  };
})();

/* ---------- ReadAloud ---------- */
/**
 * Text-to-speech for conversation messages using the Web Speech
 * Synthesis API.  Adds a speaker button to each assistant message in
 * the history panel.  Supports voice selection, speed/pitch control,
 * pause/resume/stop, and per-sentence highlighting.
 *
 * Preferences (voice URI, rate, pitch) are persisted in localStorage.
 *
 * @namespace ReadAloud
 */
const ReadAloud = (() => {
  let STORAGE_KEY = 'agenticchat_readaloud';
  const DEFAULT_RATE = 1.0;
  const DEFAULT_PITCH = 1.0;
  const MIN_RATE = 0.5;
  const MAX_RATE = 3.0;
  const MIN_PITCH = 0.5;
  const MAX_PITCH = 2.0;

  let prefs = { voiceURI: '', rate: DEFAULT_RATE, pitch: DEFAULT_PITCH };
  let speaking = false;
  let paused = false;
  let currentMsgIndex = -1;
  let controlsEl = null;

  function init() {
    load();
  }

  /** Check if the browser supports speech synthesis. */
  function isSupported() {
    return typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance === 'function';
  }

  /** Get available voices, optionally filtered to a language prefix. */
  function getVoices(langPrefix) {
    if (!isSupported()) return [];
    let voices = window.speechSynthesis.getVoices();
    if (langPrefix) {
      const prefix = langPrefix.toLowerCase();
      return voices.filter(function (v) {
        return v.lang.toLowerCase().indexOf(prefix) === 0;
      });
    }
    return voices.slice();
  }

  /** Return the user's preferred voice, or the first English one. */
  function resolveVoice() {
    let voices = getVoices();
    if (prefs.voiceURI) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].voiceURI === prefs.voiceURI) return voices[i];
      }
    }
    // Fallback: first en- voice
    for (var j = 0; j < voices.length; j++) {
      if (voices[j].lang.indexOf('en') === 0) return voices[j];
    }
    return voices[0] || null;
  }

  /** Set the preferred voice by URI. */
  function setVoice(uri) {
    prefs.voiceURI = uri;
    save();
  }

  /** Set speech rate (0.5–3.0). */
  function setRate(r) {
    r = parseFloat(r);
    if (isNaN(r)) return;
    prefs.rate = Math.max(MIN_RATE, Math.min(MAX_RATE, r));
    save();
  }

  /** Set pitch (0.5–2.0). */
  function setPitch(p) {
    p = parseFloat(p);
    if (isNaN(p)) return;
    prefs.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, p));
    save();
  }

  /** Get current preferences (rate, pitch, voiceURI). */
  function getPrefs() {
    return { voiceURI: prefs.voiceURI, rate: prefs.rate, pitch: prefs.pitch };
  }

  /**
   * Strip markdown/code fences from text for cleaner speech.
   * Removes code blocks, inline code, and markdown formatting.
   */
  function cleanTextForSpeech(text) {
    if (!text) return '';
    // Remove code blocks
    let cleaned = text.replace(/```[\s\S]*?```/g, ' code block omitted ');
    // Remove inline code
    cleaned = cleaned.replace(/`[^`]+`/g, function (m) {
      return m.slice(1, -1);
    });
    // Remove markdown emphasis
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
    // Remove markdown headers
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
    // Remove markdown links [text](url) → text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Collapse whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  }

  /**
   * Speak the given text using Web Speech Synthesis.
   * @param {string} text - Raw text to speak.
   * @param {number} [messageIndex] - Conversation index (for highlighting).
   * @returns {{ok: boolean, error: string|undefined}}
   */
  function speak(text, messageIndex) {
    if (!isSupported()) return { ok: false, error: 'Speech synthesis not supported' };
    if (!text || !text.trim()) return { ok: false, error: 'No text to speak' };

    stop(); // cancel any current speech

    let cleaned = cleanTextForSpeech(text);
    if (!cleaned) return { ok: false, error: 'No speakable text after cleanup' };

    const utterance = new SpeechSynthesisUtterance(cleaned);
    let voice = resolveVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = prefs.rate;
    utterance.pitch = prefs.pitch;

    currentMsgIndex = typeof messageIndex === 'number' ? messageIndex : -1;
    speaking = true;
    paused = false;

    utterance.onstart = function () {
      speaking = true;
      highlightMessage(currentMsgIndex, true);
      updateControls();
    };

    utterance.onend = function () {
      speaking = false;
      paused = false;
      highlightMessage(currentMsgIndex, false);
      currentMsgIndex = -1;
      updateControls();
    };

    utterance.onerror = function (e) {
      // 'canceled' is not a real error (user stopped it)
      if (e.error !== 'canceled') {
        speaking = false;
        paused = false;
        highlightMessage(currentMsgIndex, false);
        currentMsgIndex = -1;
        updateControls();
      }
    };

    window.speechSynthesis.speak(utterance);
    return { ok: true };
  }

  /** Speak a message from conversation history by index. */
  function speakMessage(messageIndex) {
    let history = ConversationManager.getHistory();
    if (messageIndex < 0 || messageIndex >= history.length) {
      return { ok: false, error: 'Invalid message index' };
    }
    return speak(history[messageIndex].content, messageIndex);
  }

  /** Pause speech. */
  function pause() {
    if (!isSupported() || !speaking) return false;
    window.speechSynthesis.pause();
    paused = true;
    updateControls();
    return true;
  }

  /** Resume paused speech. */
  function resume() {
    if (!isSupported() || !paused) return false;
    window.speechSynthesis.resume();
    paused = false;
    updateControls();
    return true;
  }

  /** Toggle pause/resume. */
  function togglePause() {
    if (paused) return resume();
    if (speaking) return pause();
    return false;
  }

  /** Stop all speech. */
  function stop() {
    if (!isSupported()) return false;
    window.speechSynthesis.cancel();
    speaking = false;
    paused = false;
    if (currentMsgIndex >= 0) {
      highlightMessage(currentMsgIndex, false);
    }
    currentMsgIndex = -1;
    updateControls();
    return true;
  }

  /** Is speech currently playing? */
  function isSpeaking() { return speaking; }

  /** Is speech currently paused? */
  function isPaused() { return paused; }

  /** Get the message index currently being read. */
  function getCurrentIndex() { return currentMsgIndex; }

  /** Highlight or un-highlight a message in the history panel. */
  function highlightMessage(msgIndex, on) {
    let container = document.getElementById('history-messages');
    if (!container) return;
    let msgs = container.querySelectorAll('.history-msg');
    let history = ConversationManager.getHistory();
    let nonSystemIdx = 0;
    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (i === msgIndex && nonSystemIdx < msgs.length) {
        if (on) {
          msgs[nonSystemIdx].classList.add('readaloud-active');
        } else {
          msgs[nonSystemIdx].classList.remove('readaloud-active');
        }
        break;
      }
      nonSystemIdx++;
    }
  }

  /**
   * Render the inline controls bar on a message element.
   * Shows a 🔊 button; when speaking, shows pause/stop buttons too.
   */
  function renderSpeakButton(messageElement, messageIndex) {
    // Remove existing speak button if any
    let existing = messageElement.querySelector('.readaloud-btn');
    if (existing) existing.remove();

    let btn = document.createElement('button');
    btn.className = 'readaloud-btn';
    btn.setAttribute('aria-label', 'Read aloud');
    btn.setAttribute('title', 'Read aloud');

    if (speaking && currentMsgIndex === messageIndex) {
      btn.textContent = paused ? '\u25B6\uFE0F' : '\u23F8\uFE0F';
      btn.setAttribute('aria-label', paused ? 'Resume reading' : 'Pause reading');
      btn.setAttribute('title', paused ? 'Resume' : 'Pause');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePause();
        decorateMessages();
      });

      // Add stop button
      let stopBtn = document.createElement('button');
      stopBtn.className = 'readaloud-btn readaloud-stop';
      stopBtn.textContent = '\u23F9\uFE0F';
      stopBtn.setAttribute('aria-label', 'Stop reading');
      stopBtn.setAttribute('title', 'Stop');
      stopBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        stop();
        decorateMessages();
      });

      let roleEl = messageElement.querySelector('.msg-role');
      if (roleEl) {
        roleEl.appendChild(btn);
        roleEl.appendChild(stopBtn);
      } else {
        messageElement.insertBefore(stopBtn, messageElement.firstChild);
        messageElement.insertBefore(btn, messageElement.firstChild);
      }
    } else {
      btn.textContent = '\uD83D\uDD0A';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        speakMessage(messageIndex);
        decorateMessages();
      });

      const roleEl2 = messageElement.querySelector('.msg-role');
      if (roleEl2) {
        roleEl2.appendChild(btn);
      } else {
        messageElement.insertBefore(btn, messageElement.firstChild);
      }
    }
  }

  /** Render a floating controls panel when speech is active. */
  function updateControls() {
    if (!controlsEl) {
      controlsEl = document.getElementById('readaloud-controls');
    }
    if (!controlsEl) return;

    if (!speaking) {
      controlsEl.style.display = 'none';
      return;
    }

    controlsEl.style.display = '';
    const stateSpan = controlsEl.querySelector('.readaloud-state');
    if (stateSpan) {
      stateSpan.textContent = paused ? 'Paused' : 'Speaking\u2026';
    }

    let pauseBtn = controlsEl.querySelector('.readaloud-ctrl-pause');
    if (pauseBtn) {
      pauseBtn.textContent = paused ? '\u25B6\uFE0F Resume' : '\u23F8\uFE0F Pause';
    }
  }

  /** Build the floating controls panel (once, on init). */
  function buildControls() {
    if (document.getElementById('readaloud-controls')) return;

    let panel = document.createElement('div');
    panel.id = 'readaloud-controls';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Read aloud controls');
    panel.style.display = 'none';

    const state = document.createElement('span');
    state.className = 'readaloud-state';
    state.textContent = '';
    panel.appendChild(state);

    let pauseBtn = document.createElement('button');
    pauseBtn.className = 'readaloud-ctrl-pause btn-sm';
    pauseBtn.textContent = '\u23F8\uFE0F Pause';
    pauseBtn.addEventListener('click', function () {
      togglePause();
    });
    panel.appendChild(pauseBtn);

    let stopBtn = document.createElement('button');
    stopBtn.className = 'readaloud-ctrl-stop btn-sm';
    stopBtn.textContent = '\u23F9\uFE0F Stop';
    stopBtn.addEventListener('click', function () {
      stop();
    });
    panel.appendChild(stopBtn);

    // Speed slider
    const speedLabel = document.createElement('label');
    speedLabel.className = 'readaloud-speed-label';
    speedLabel.textContent = 'Speed: ' + prefs.rate.toFixed(1) + 'x';

    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.className = 'readaloud-speed';
    speedSlider.min = String(MIN_RATE);
    speedSlider.max = String(MAX_RATE);
    speedSlider.step = '0.1';
    speedSlider.value = String(prefs.rate);
    speedSlider.setAttribute('aria-label', 'Speech speed');
    speedSlider.addEventListener('input', function () {
      setRate(this.value);
      speedLabel.textContent = 'Speed: ' + prefs.rate.toFixed(1) + 'x';
    });

    panel.appendChild(speedLabel);
    panel.appendChild(speedSlider);

    let output = document.getElementById('chat-output');
    if (output && output.parentNode) {
      output.parentNode.insertBefore(panel, output);
    } else {
      document.body.appendChild(panel);
    }
    controlsEl = panel;
  }

  /** Decorate assistant messages in the history panel with speak buttons. */
  function decorateMessages() {
    let container = document.getElementById('history-messages');
    if (!container) return;
    let msgs = container.querySelectorAll('.history-msg');
    let history = ConversationManager.getHistory();
    let nonSystemIdx = 0;
    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      // Only add speak buttons to assistant messages
      if (history[i].role === 'assistant' && nonSystemIdx < msgs.length) {
        renderSpeakButton(msgs[nonSystemIdx], i);
      }
      nonSystemIdx++;
    }
  }

  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) { /* storage full */ }
  }

  function load() {
    try {
      let data = SafeStorage.get(STORAGE_KEY);
      if (data) {
        let parsed = sanitizeStorageObject(JSON.parse(data));
        if (parsed && typeof parsed === 'object') {
          if (parsed.voiceURI) prefs.voiceURI = String(parsed.voiceURI);
          if (typeof parsed.rate === 'number') prefs.rate = Math.max(MIN_RATE, Math.min(MAX_RATE, parsed.rate));
          if (typeof parsed.pitch === 'number') prefs.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, parsed.pitch));
        }
      }
    } catch (e) {
      prefs = { voiceURI: '', rate: DEFAULT_RATE, pitch: DEFAULT_PITCH };
    }
  }

  function reset() {
    stop();
    prefs = { voiceURI: '', rate: DEFAULT_RATE, pitch: DEFAULT_PITCH };
    SafeStorage.remove(STORAGE_KEY);
  }

  function _getState() {
    return {
      speaking: speaking,
      paused: paused,
      currentMsgIndex: currentMsgIndex,
      prefs: getPrefs()
    };
  }

  return {
    init: init,
    isSupported: isSupported,
    getVoices: getVoices,
    resolveVoice: resolveVoice,
    setVoice: setVoice,
    setRate: setRate,
    setPitch: setPitch,
    getPrefs: getPrefs,
    cleanTextForSpeech: cleanTextForSpeech,
    speak: speak,
    speakMessage: speakMessage,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    stop: stop,
    isSpeaking: isSpeaking,
    isPaused: isPaused,
    getCurrentIndex: getCurrentIndex,
    highlightMessage: highlightMessage,
    renderSpeakButton: renderSpeakButton,
    updateControls: updateControls,
    buildControls: buildControls,
    decorateMessages: decorateMessages,
    decorateOne: renderSpeakButton,
    reset: reset,
    _getState: _getState
  };
})();



/* ---------- MessageDiff ---------- */
/**
 * Message Diff Viewer — compare any two conversation messages with a
 * visual line-by-line diff.  Useful for seeing how an AI response
 * changes when a prompt is rephrased, or comparing two code snippets.
 *
 * Workflow:
 *   1. User clicks "Compare" on a message → that message is selected
 *      as the first diff target (highlighted with a border).
 *   2. User clicks "Compare" on a second message → a diff modal opens
 *      showing both messages side-by-side with additions (green) and
 *      deletions (red) highlighted.
 *   3. The diff uses a longest-common-subsequence (LCS) algorithm to
 *      produce a minimal line-level diff.
 *
 * The module decorates assistant and user messages in the chat output
 * with a small "Compare" button.
 *
 * @namespace MessageDiff
 */
const MessageDiff = (() => {
  let firstSelection = null; // { index, role, content }
  let modalEl = null;

  function init() {
    buildModal();
  }

  // ── LCS-based line diff ──────────────────────────────────────

  /**
   * Compute a line-level diff between two texts using the LCS algorithm.
   * Returns an array of { type: 'same'|'add'|'del', text: string }.
   */
  function diffLines(textA, textB) {
    const linesA = (textA || '').split('\n');
    const linesB = (textB || '').split('\n');
    let m = linesA.length;
    let n = linesB.length;

    // Build LCS table
    const dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [];
      for (var j = 0; j <= n; j++) {
        if (i === 0 || j === 0) {
          dp[i][j] = 0;
        } else if (linesA[i - 1] === linesB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to build diff
    let result = [];
    let ii = m;
    let jj = n;
    while (ii > 0 || jj > 0) {
      if (ii > 0 && jj > 0 && linesA[ii - 1] === linesB[jj - 1]) {
        result.unshift({ type: 'same', text: linesA[ii - 1] });
        ii--;
        jj--;
      } else if (jj > 0 && (ii === 0 || dp[ii][jj - 1] >= dp[ii - 1][jj])) {
        result.unshift({ type: 'add', text: linesB[jj - 1] });
        jj--;
      } else {
        result.unshift({ type: 'del', text: linesA[ii - 1] });
        ii--;
      }
    }

    return result;
  }

  /**
   * Compute diff statistics from a diff result.
   */
  function diffStats(diff) {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (var i = 0; i < diff.length; i++) {
      if (diff[i].type === 'add') added++;
      else if (diff[i].type === 'del') removed++;
      else unchanged++;
    }
    return { added: added, removed: removed, unchanged: unchanged, total: diff.length };
  }

  // ── Selection handling ───────────────────────────────────────

  /**
   * Select a message for comparison.
   * First call selects the "left" side; second call opens the diff.
   */
  function selectMessage(index) {
    let history = ConversationManager.getHistory();
    if (index < 0 || index >= history.length) return;

    let msg = history[index];

    if (firstSelection === null) {
      // First selection
      firstSelection = { index: index, role: msg.role, content: msg.content };
      highlightSelected(index, true);
      decorateMessages(); // update buttons to show "comparing..."
    } else {
      if (firstSelection.index === index) {
        // Deselect
        clearSelection();
        return;
      }
      // Second selection — show diff
      const second = { index: index, role: msg.role, content: msg.content };
      showDiff(firstSelection, second);
      highlightSelected(firstSelection.index, false);
      firstSelection = null;
      decorateMessages();
    }
  }

  /** Clear the current selection. */
  function clearSelection() {
    if (firstSelection !== null) {
      highlightSelected(firstSelection.index, false);
      firstSelection = null;
      decorateMessages();
    }
  }

  /** Get the currently selected message (or null). */
  function getSelection() {
    return firstSelection ? { index: firstSelection.index, role: firstSelection.role } : null;
  }

  /** Highlight/unhighlight a message element. */
  function highlightSelected(msgIndex, on) {
    let chatOutput = document.getElementById('chat-output');
    if (!chatOutput) return;
    let msgs = chatOutput.querySelectorAll('.msg');
    let history = ConversationManager.getHistory();
    let domIdx = 0;
    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (i === msgIndex && domIdx < msgs.length) {
        if (on) {
          msgs[domIdx].style.outline = '2px solid #38bdf8';
          msgs[domIdx].style.outlineOffset = '3px';
        } else {
          msgs[domIdx].style.outline = '';
          msgs[domIdx].style.outlineOffset = '';
        }
        break;
      }
      domIdx++;
    }
  }

  // ── Modal ────────────────────────────────────────────────────

  function buildModal() {
    if (document.getElementById('diff-modal')) return;

    let modal = document.createElement('div');
    modal.id = 'diff-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Message diff viewer');
    modal.style.cssText =
      'display:none;position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center';

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    let content = document.createElement('div');
    content.id = 'diff-modal-content';
    content.style.cssText =
      'background:#0d1117;color:#c9d1d9;border-radius:12px;width:90%;max-width:900px;' +
      'max-height:85vh;overflow:hidden;display:flex;flex-direction:column;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid #30363d';

    // Header
    let header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:16px 20px;border-bottom:1px solid #30363d;flex-shrink:0';

    let title = document.createElement('div');
    title.id = 'diff-modal-title';
    title.style.cssText = 'font-size:16px;font-weight:600';
    title.textContent = '\uD83D\uDD0D Message Diff';
    header.appendChild(title);

    let statsEl = document.createElement('span');
    statsEl.id = 'diff-stats';
    statsEl.style.cssText = 'font-size:13px;color:#8b949e;margin-left:12px';
    header.appendChild(statsEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close diff viewer');
    closeBtn.style.cssText =
      'background:none;border:none;color:#8b949e;font-size:20px;cursor:pointer;' +
      'padding:4px 8px;border-radius:4px;transition:background 0.15s';
    closeBtn.addEventListener('mouseenter', function () { this.style.background = '#21262d'; });
    closeBtn.addEventListener('mouseleave', function () { this.style.background = 'none'; });
    closeBtn.addEventListener('click', closeModal);
    header.appendChild(closeBtn);

    content.appendChild(header);

    // Diff body
    let body = document.createElement('div');
    body.id = 'diff-body';
    body.style.cssText =
      'overflow-y:auto;padding:0;flex:1;font-family:\'SF Mono\',Consolas,monospace;font-size:13px;line-height:1.6';
    content.appendChild(body);

    modal.appendChild(content);
    document.body.appendChild(modal);
    modalEl = modal;

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.style.display === 'flex') {
        closeModal();
      }
    });
  }

  function showDiff(msgA, msgB) {
    buildModal();
    let diff = diffLines(msgA.content, msgB.content);
    let stats = diffStats(diff);

    // Update title
    const titleEl = document.getElementById('diff-modal-title');
    if (titleEl) {
      const roleA = msgA.role === 'user' ? '\uD83D\uDC64' : '\uD83E\uDD16';
      const roleB = msgB.role === 'user' ? '\uD83D\uDC64' : '\uD83E\uDD16';
      titleEl.textContent = '\uD83D\uDD0D Diff: ' + roleA + ' #' + (msgA.index + 1) +
        ' \u2194 ' + roleB + ' #' + (msgB.index + 1);
    }

    // Update stats
    let statsEl = document.getElementById('diff-stats');
    if (statsEl) {
      let parts = [];
      if (stats.added > 0) parts.push('+' + stats.added + ' added');
      if (stats.removed > 0) parts.push('-' + stats.removed + ' removed');
      parts.push(stats.unchanged + ' unchanged');
      statsEl.textContent = parts.join(', ');
    }

    // Render diff lines
    let body = document.getElementById('diff-body');
    if (!body) return;
    body.textContent = '';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse';

    let lineNumA = 0;
    let lineNumB = 0;

    for (var i = 0; i < diff.length; i++) {
      let entry = diff[i];
      const tr = document.createElement('tr');

      const tdNumA = document.createElement('td');
      tdNumA.style.cssText =
        'width:40px;text-align:right;padding:0 8px;color:#484f58;' +
        'user-select:none;font-size:12px;border-right:1px solid #21262d;vertical-align:top';

      const tdNumB = document.createElement('td');
      tdNumB.style.cssText =
        'width:40px;text-align:right;padding:0 8px;color:#484f58;' +
        'user-select:none;font-size:12px;border-right:1px solid #21262d;vertical-align:top';

      const tdMarker = document.createElement('td');
      tdMarker.style.cssText =
        'width:20px;text-align:center;padding:0 4px;font-weight:700;' +
        'user-select:none;vertical-align:top';

      const tdContent = document.createElement('td');
      tdContent.style.cssText =
        'padding:0 12px;white-space:pre-wrap;word-break:break-word;vertical-align:top';

      if (entry.type === 'same') {
        lineNumA++;
        lineNumB++;
        tdNumA.textContent = lineNumA;
        tdNumB.textContent = lineNumB;
        tdMarker.textContent = '';
        tdContent.textContent = entry.text;
        tr.style.background = 'transparent';
      } else if (entry.type === 'del') {
        lineNumA++;
        tdNumA.textContent = lineNumA;
        tdNumB.textContent = '';
        tdMarker.textContent = '\u2212';
        tdMarker.style.color = '#f85149';
        tdContent.textContent = entry.text;
        tr.style.background = 'rgba(248,81,73,0.1)';
        tdContent.style.color = '#ffa198';
      } else if (entry.type === 'add') {
        lineNumB++;
        tdNumA.textContent = '';
        tdNumB.textContent = lineNumB;
        tdMarker.textContent = '+';
        tdMarker.style.color = '#3fb950';
        tdContent.textContent = entry.text;
        tr.style.background = 'rgba(63,185,80,0.1)';
        tdContent.style.color = '#7ee787';
      }

      tr.appendChild(tdNumA);
      tr.appendChild(tdNumB);
      tr.appendChild(tdMarker);
      tr.appendChild(tdContent);
      table.appendChild(tr);
    }

    body.appendChild(table);

    // Show modal
    modalEl.style.display = 'flex';
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  /** Check if the modal is currently visible. */
  function isOpen() {
    return modalEl !== null && modalEl.style.display === 'flex';
  }

  // ── Message decoration ───────────────────────────────────────

  /**
   * Decorate chat messages with a "Compare" button.
   * Called after messages are rendered or selection changes.
   */
  function decorateMessages() {
    let chatOutput = document.getElementById('chat-output');
    if (!chatOutput) return;

    let msgs = chatOutput.querySelectorAll('.msg');
    let history = ConversationManager.getHistory();
    let domIdx = 0;

    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (domIdx < msgs.length) {
        addCompareButton(msgs[domIdx], i);
      }
      domIdx++;
    }
  }

  function addCompareButton(msgEl, msgIndex) {
    // Remove existing compare button
    let existing = msgEl.querySelector('.diff-compare-btn');
    if (existing) existing.remove();

    let btn = document.createElement('button');
    btn.className = 'diff-compare-btn';
    btn.style.cssText =
      'background:none;border:1px solid #30363d;color:#8b949e;font-size:11px;' +
      'padding:2px 8px;border-radius:4px;cursor:pointer;margin-left:6px;' +
      'transition:all 0.15s;vertical-align:middle';

    btn.addEventListener('mouseenter', function () {
      this.style.borderColor = '#58a6ff';
      this.style.color = '#58a6ff';
    });
    btn.addEventListener('mouseleave', function () {
      this.style.borderColor = '#30363d';
      this.style.color = '#8b949e';
    });

    if (firstSelection !== null && firstSelection.index === msgIndex) {
      // This message is selected
      btn.textContent = '\u2716 Cancel';
      btn.style.borderColor = '#f85149';
      btn.style.color = '#f85149';
      btn.addEventListener('mouseenter', function () {
        this.style.borderColor = '#f85149';
        this.style.color = '#f85149';
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        clearSelection();
      });
    } else if (firstSelection !== null) {
      // Another message is selected — this is a potential second target
      btn.textContent = '\uD83D\uDD0D Diff with #' + (firstSelection.index + 1);
      btn.style.borderColor = '#3fb950';
      btn.style.color = '#3fb950';
      btn.addEventListener('mouseenter', function () {
        this.style.borderColor = '#3fb950';
        this.style.color = '#3fb950';
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        selectMessage(msgIndex);
      });
    } else {
      // No selection yet
      btn.textContent = '\u2194 Compare';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        selectMessage(msgIndex);
      });
    }

    // Append to role area or message itself
    let roleEl = msgEl.querySelector('.msg-role');
    if (roleEl) {
      roleEl.appendChild(btn);
    } else {
      msgEl.appendChild(btn);
    }
  }

  /** Reset all state. */
  function reset() {
    clearSelection();
    closeModal();
  }

  return {
    init: init,
    diffLines: diffLines,
    diffStats: diffStats,
    selectMessage: selectMessage,
    clearSelection: clearSelection,
    getSelection: getSelection,
    showDiff: showDiff,
    closeModal: closeModal,
    isOpen: isOpen,
    decorateMessages: decorateMessages,
    reset: reset
  };
})();


/* ---------- ConversationTimeline ---------- */
/**
 * Conversation Timeline — a visual minimap/navigator showing the
 * conversation structure as a vertical strip. Each message is rendered
 * as a colored segment whose height is proportional to its length.
 * Users can:
 *   - See the overall conversation shape at a glance
 *   - Click any segment to scroll to that message
 *   - Hover for a preview tooltip (role + first line)
 *   - See markers for bookmarks, pinned messages, and code blocks
 *   - Track the current viewport position via an overlay indicator
 *
 * The timeline lives in a toggleable sidebar on the right edge.
 *
 * @namespace ConversationTimeline
 */
const ConversationTimeline = (() => {
  'use strict';

  let containerEl = null;
  let stripEl = null;
  let viewportEl = null;
  let toggleBtn = null;
  let tooltipEl = null;
  let isVisible = false;
  let segments = [];
  let scrollRAF = null;
  let refreshTimer = null;
  const REFRESH_DEBOUNCE_MS = 150;

  /** CSS injected once. */
  let styleInjected = false;
  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const css = [
      '#timeline-container {',
      '  position: fixed; right: 0; top: 0; width: 48px; height: 100vh;',
      '  background: var(--tl-bg, #0d1117); border-left: 1px solid var(--tl-border, #30363d);',
      '  z-index: 800; display: flex; flex-direction: column; transition: transform 0.2s ease;',
      '  transform: translateX(100%);',
      '}',
      '#timeline-container.tl-open { transform: translateX(0); }',
      '#timeline-strip {',
      '  flex: 1; overflow: hidden; position: relative; cursor: pointer;',
      '  margin: 4px 6px;',
      '}',
      '.tl-segment {',
      '  width: 100%; border-radius: 2px; position: absolute; left: 0;',
      '  transition: opacity 0.15s;',
      '}',
      '.tl-segment:hover { opacity: 0.8; }',
      '.tl-segment-user { background: var(--tl-user, #58a6ff); }',
      '.tl-segment-assistant { background: var(--tl-asst, #3fb950); }',
      '.tl-segment-system { background: var(--tl-sys, #484f58); }',
      '.tl-marker {',
      '  position: absolute; right: 0; width: 6px; height: 6px;',
      '  border-radius: 50%; z-index: 2; pointer-events: none;',
      '}',
      '.tl-marker-bookmark { background: #f0883e; }',
      '.tl-marker-pin { background: #f85149; }',
      '.tl-marker-code { background: #d2a8ff; }',
      '#timeline-viewport {',
      '  position: absolute; left: 2px; right: 2px; border: 1px solid rgba(255,255,255,0.3);',
      '  background: rgba(255,255,255,0.06); border-radius: 2px; pointer-events: none;',
      '  transition: top 0.1s ease, height 0.1s ease;',
      '}',
      '#timeline-toggle {',
      '  position: fixed; right: 4px; top: 50%; transform: translateY(-50%);',
      '  z-index: 801; background: var(--tl-btn-bg, #21262d); border: 1px solid var(--tl-border, #30363d);',
      '  color: var(--tl-btn-fg, #8b949e); font-size: 14px; width: 24px; height: 48px;',
      '  border-radius: 4px 0 0 4px; cursor: pointer; display: flex; align-items: center;',
      '  justify-content: center; transition: right 0.2s ease, background 0.15s;',
      '  padding: 0; line-height: 1;',
      '}',
      '#timeline-toggle:hover { background: var(--tl-btn-hover, #30363d); }',
      '#timeline-toggle.tl-shifted { right: 52px; }',
      '#timeline-tooltip {',
      '  position: fixed; z-index: 900; background: #1c2128; color: #c9d1d9;',
      '  border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px;',
      '  font-size: 12px; max-width: 220px; pointer-events: none;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,0.4); display: none;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.tl-tooltip-role { font-weight: 600; margin-right: 4px; }',
      '.tl-tooltip-preview { color: #8b949e; }'
    ].join('\n');
    let style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    buildDOM();
    // Listen for chat output changes via MutationObserver.
    // Debounce to avoid excessive rebuilds during streaming responses
    // where mutations fire on every text chunk (potentially hundreds/sec).
    let chatOutput = document.getElementById('chat-output');
    if (chatOutput) {
      const observer = new MutationObserver(function () { scheduleRefresh(); });
      observer.observe(chatOutput, { childList: true, subtree: true });
    }
    // Track scroll position
    const chatArea = getChatScrollParent();
    if (chatArea) {
      chatArea.addEventListener('scroll', scheduleViewportUpdate);
    }
    window.addEventListener('resize', scheduleViewportUpdate);
  }

  function buildDOM() {
    // Container
    containerEl = document.createElement('div');
    containerEl.id = 'timeline-container';
    containerEl.setAttribute('role', 'navigation');
    containerEl.setAttribute('aria-label', 'Conversation timeline');

    // Strip (where segments go)
    stripEl = document.createElement('div');
    stripEl.id = 'timeline-strip';
    stripEl.addEventListener('click', handleStripClick);
    stripEl.addEventListener('mousemove', handleStripHover);
    stripEl.addEventListener('mouseleave', hideTooltip);

    // Viewport indicator
    viewportEl = document.createElement('div');
    viewportEl.id = 'timeline-viewport';
    stripEl.appendChild(viewportEl);

    containerEl.appendChild(stripEl);
    document.body.appendChild(containerEl);

    // Tooltip
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'timeline-tooltip';
    document.body.appendChild(tooltipEl);

    // Toggle button
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'timeline-toggle';
    toggleBtn.textContent = '\u25C0';
    toggleBtn.title = 'Toggle conversation timeline (Alt+T)';
    toggleBtn.setAttribute('aria-label', 'Toggle conversation timeline');
    toggleBtn.addEventListener('click', toggle);
    document.body.appendChild(toggleBtn);
  }

  // ── Toggle ───────────────────────────────────────────────

  function toggle() {
    isVisible = !isVisible;
    containerEl.classList.toggle('tl-open', isVisible);
    toggleBtn.classList.toggle('tl-shifted', isVisible);
    toggleBtn.textContent = isVisible ? '\u25B6' : '\u25C0';
    if (isVisible) {
      refresh();
    }
  }

  function show() { if (!isVisible) toggle(); }
  function hide() { if (isVisible) toggle(); }

  function getVisible() { return isVisible; }

  /**
   * Schedule a debounced refresh.  During streaming responses the
   * MutationObserver fires on every text chunk, which would otherwise
   * cause hundreds of full DOM rebuilds per second.  This collapses
   * those into a single trailing refresh after REFRESH_DEBOUNCE_MS ms
   * of quiet.
   */
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // ── Refresh ──────────────────────────────────────────────

  function refresh() {
    if (!isVisible || !stripEl) return;

    let history = ConversationManager.getHistory();
    const nonSystem = [];
    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      nonSystem.push({ index: i, msg: history[i] });
    }

    // Calculate segment sizes proportional to content length
    let totalLen = 0;
    const lengths = [];
    for (var j = 0; j < nonSystem.length; j++) {
      const len = Math.max(1, (nonSystem[j].msg.content || '').length);
      lengths.push(len);
      totalLen += len;
    }

    // Clear old segments
    let children = stripEl.querySelectorAll('.tl-segment, .tl-marker');
    for (var c = 0; c < children.length; c++) {
      children[c].remove();
    }
    segments = [];

    let stripHeight = stripEl.clientHeight;
    if (stripHeight <= 0) stripHeight = 400; // fallback
    const minSegHeight = 3;
    const gap = 1;
    const totalGap = Math.max(0, nonSystem.length - 1) * gap;
    const availHeight = stripHeight - totalGap;

    let yPos = 0;
    for (var k = 0; k < nonSystem.length; k++) {
      const fraction = lengths[k] / totalLen;
      const segH = Math.max(minSegHeight, Math.round(fraction * availHeight));

      let seg = document.createElement('div');
      seg.className = 'tl-segment tl-segment-' + nonSystem[k].msg.role;
      seg.style.top = yPos + 'px';
      seg.style.height = segH + 'px';
      seg.dataset.msgIndex = nonSystem[k].index;
      seg.dataset.domIndex = k;
      stripEl.appendChild(seg);

      segments.push({
        el: seg,
        msgIndex: nonSystem[k].index,
        domIndex: k,
        top: yPos,
        height: segH,
        role: nonSystem[k].msg.role,
        preview: getPreview(nonSystem[k].msg)
      });

      // Markers
      addMarkers(seg, nonSystem[k], yPos, segH);

      yPos += segH + gap;
    }

    updateViewportIndicator();
  }

  function getPreview(msg) {
    let text = (msg.content || '').trim();
    let firstLine = text.split('\n')[0] || '';
    if (firstLine.length > 60) firstLine = firstLine.substring(0, 57) + '...';
    return firstLine;
  }

  function addMarkers(segEl, entry, yPos, segH) {
    let content = entry.msg.content || '';

    // Code block marker
    if (content.indexOf('```') !== -1) {
      let m = document.createElement('div');
      m.className = 'tl-marker tl-marker-code';
      m.style.top = (yPos + 2) + 'px';
      stripEl.appendChild(m);
    }

    // Bookmark marker (check ChatBookmarks if available)
    if (typeof ChatBookmarks !== 'undefined' && ChatBookmarks.isBookmarked &&
        ChatBookmarks.isBookmarked(entry.index)) {
      let bm = document.createElement('div');
      bm.className = 'tl-marker tl-marker-bookmark';
      bm.style.top = (yPos + segH - 8) + 'px';
      stripEl.appendChild(bm);
    }

    // Pin marker (check MessagePinning if available)
    if (typeof MessagePinning !== 'undefined' && MessagePinning.isPinned &&
        MessagePinning.isPinned(entry.index)) {
      const pm = document.createElement('div');
      pm.className = 'tl-marker tl-marker-pin';
      pm.style.top = (yPos + Math.floor(segH / 2) - 3) + 'px';
      stripEl.appendChild(pm);
    }
  }

  // ── Viewport indicator ───────────────────────────────────

  function getChatScrollParent() {
    let chatOutput = document.getElementById('chat-output');
    if (!chatOutput) return null;
    // chat-output itself is typically the scroll container
    return chatOutput;
  }

  function scheduleViewportUpdate() {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(function () {
      scrollRAF = null;
      updateViewportIndicator();
    });
  }

  function updateViewportIndicator() {
    if (!isVisible || !viewportEl || !stripEl) return;
    let chatOutput = getChatScrollParent();
    if (!chatOutput) return;

    const scrollH = chatOutput.scrollHeight;
    const clientH = chatOutput.clientHeight;
    const scrollT = chatOutput.scrollTop;
    const stripH = stripEl.clientHeight;

    if (scrollH <= 0 || stripH <= 0) return;

    const vpTop = (scrollT / scrollH) * stripH;
    let vpHeight = (clientH / scrollH) * stripH;
    vpHeight = Math.max(vpHeight, 8); // minimum visible size

    viewportEl.style.top = Math.round(vpTop) + 'px';
    viewportEl.style.height = Math.round(vpHeight) + 'px';
  }

  // ── Interaction ──────────────────────────────────────────

  function handleStripClick(e) {
    let seg = findSegmentAt(e);
    if (!seg) return;
    scrollToMessage(seg.domIndex);
  }

  function handleStripHover(e) {
    let seg = findSegmentAt(e);
    if (!seg) {
      hideTooltip();
      return;
    }
    showTooltip(seg, e);
  }

  function findSegmentAt(e) {
    const rect = stripEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    for (var i = 0; i < segments.length; i++) {
      if (y >= segments[i].top && y <= segments[i].top + segments[i].height) {
        return segments[i];
      }
    }
    return null;
  }

  function scrollToMessage(domIndex) {
    let chatOutput = document.getElementById('chat-output');
    if (!chatOutput) return;
    let msgs = chatOutput.querySelectorAll('.msg');
    if (domIndex >= 0 && domIndex < msgs.length) {
      if (typeof msgs[domIndex].scrollIntoView === 'function') {
        msgs[domIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Brief highlight
      msgs[domIndex].style.transition = 'box-shadow 0.3s';
      msgs[domIndex].style.boxShadow = '0 0 0 2px #58a6ff';
      setTimeout(function () {
        msgs[domIndex].style.boxShadow = '';
      }, 1200);
    }
  }

  function showTooltip(seg, e) {
    if (!tooltipEl) return;
    const roleEmoji = seg.role === 'user' ? '\uD83D\uDC64' : '\uD83E\uDD16';
    tooltipEl.innerHTML = '<span class="tl-tooltip-role">' + roleEmoji + '</span>' +
      '<span class="tl-tooltip-preview">' + escapeHtml(seg.preview) + '</span>';
    tooltipEl.style.display = 'block';
    tooltipEl.style.top = e.clientY + 'px';
    tooltipEl.style.left = (e.clientX - tooltipEl.offsetWidth - 12) + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  const escapeHtml = _escapeHtml;

  // ── Stats ────────────────────────────────────────────────

  /**
   * Get timeline statistics for the current conversation.
   * @returns {{ total: number, user: number, assistant: number, hasCode: number }}
   */
  function getStats() {
    let history = ConversationManager.getHistory();
    let total = 0, user = 0, assistant = 0, hasCode = 0;
    for (var i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      total++;
      if (history[i].role === 'user') user++;
      else if (history[i].role === 'assistant') assistant++;
      if ((history[i].content || '').indexOf('```') !== -1) hasCode++;
    }
    return { total: total, user: user, assistant: assistant, hasCode: hasCode };
  }

  /**
   * Get the segment data array (for testing).
   * @returns {Array}
   */
  function getSegments() {
    return segments.slice();
  }

  return {
    init: init,
    toggle: toggle,
    show: show,
    hide: hide,
    isVisible: getVisible,
    refresh: refresh,
    getStats: getStats,
    getSegments: getSegments,
    scrollToMessage: scrollToMessage
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('send-btn').addEventListener('click', ChatController.send);
  document.getElementById('cancel-btn').addEventListener('click', () => {
    ChatController.cancelRequest();
    SandboxRunner.cancel();
  });
  document.getElementById('clear-btn').addEventListener('click', ChatController.clearHistory);

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    // Input history navigation (Up/Down)
    const input = document.getElementById('chat-input');
    if (InputHistory.handleKeydown(e, input)) { e.preventDefault(); return; }
    if (e.key === 'Enter') { e.preventDefault(); ChatController.send(); }
  });

  document.getElementById('chat-input').addEventListener('input', function () {
    InputHistory.resetCursor(); // typing resets history navigation
    UIController.updateCharCount(this.value.length);
  });

  document.getElementById('user-api-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ChatController.submitServiceKey(); }
  });

  document.getElementById('apikey-submit-btn').addEventListener('click',
    ChatController.submitServiceKey);

  // History panel
  document.getElementById('history-btn').addEventListener('click', HistoryPanel.toggle);
  document.getElementById('history-close-btn').addEventListener('click', HistoryPanel.close);
  document.getElementById('history-overlay').addEventListener('click', HistoryPanel.close);
  document.getElementById('export-md-btn').addEventListener('click', HistoryPanel.exportAsMarkdown);
  document.getElementById('export-json-btn').addEventListener('click', HistoryPanel.exportAsJSON);
  document.getElementById('export-html-btn').addEventListener('click', HistoryPanel.exportAsHTML);
  document.getElementById('export-csv-btn').addEventListener('click', HistoryPanel.exportAsCSV);

  // Templates panel
  document.getElementById('templates-btn').addEventListener('click', PromptTemplates.toggle);
  document.getElementById('templates-close-btn').addEventListener('click', PromptTemplates.close);
  document.getElementById('templates-overlay').addEventListener('click', PromptTemplates.close);
  document.getElementById('templates-search').addEventListener('input', PromptTemplates.handleSearchDebounced);

  // Keyboard shortcut: Escape closes history panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      MessageDiff.closeModal();
      HistoryPanel.close();
      PromptTemplates.close();
      SnippetLibrary.close();
      SnippetLibrary.closeSaveDialog();
      SessionManager.close();
      SessionManager.closeSaveDialog();
      KeyboardShortcuts.hideHelp();
      ChatStats.close();
      PersonaPresets.close();
      ModelSelector.close();
      Scratchpad.close();
      ConversationChapters.closePanel();
      UsageHeatmap.close();
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', KeyboardShortcuts.handleKeydown);

  // Voice input
  const voiceBtn = document.getElementById('voice-btn');
  if (!VoiceInput.isSupported()) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Voice input not supported in this browser';
  }

  // Wire up result callback: update chat input in real-time
  VoiceInput.onResult((finalText, interimText) => {
    const input = document.getElementById('chat-input');
    if (input) {
      // Show final + interim (interim in progress)
      const combined = (finalText + interimText).trim();
      input.value = combined;
      UIController.updateCharCount(combined.length);
    }
  });

  // Wire up state change: toggle button appearance
  VoiceInput.onStateChange((listening) => {
    if (listening) {
      voiceBtn.classList.add('voice-recording');
      voiceBtn.textContent = '⏹️';
      voiceBtn.title = 'Stop voice input';
    } else {
      voiceBtn.classList.remove('voice-recording');
      voiceBtn.textContent = '🎤';
      voiceBtn.title = 'Voice input — speak your prompt (Ctrl+M)';
    }
  });

  voiceBtn.addEventListener('click', () => {
    const result = VoiceInput.toggle();
    // If stopped, the transcript is already in the input field
    if (!result.listening && result.transcript) {
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }
  });

  // Shortcuts help button + modal close
  document.getElementById('shortcuts-btn').addEventListener('click', KeyboardShortcuts.toggleHelp);
  document.getElementById('shortcuts-modal-close').addEventListener('click', KeyboardShortcuts.hideHelp);
  document.getElementById('shortcuts-modal').addEventListener('click', (e) => {
    // Close when clicking overlay (outside modal content)
    if (e.target.id === 'shortcuts-modal') KeyboardShortcuts.hideHelp();
  });

  // Theme toggle
  document.getElementById('theme-btn').addEventListener('click', ThemeManager.toggle);
  ThemeManager.init();

  // Message search bar
  document.getElementById('search-input').addEventListener('input', MessageSearch.handleInput);
  document.getElementById('search-input').addEventListener('keydown', MessageSearch.handleKeydown);
  document.getElementById('search-prev').addEventListener('click', MessageSearch.prev);
  document.getElementById('search-next').addEventListener('click', MessageSearch.next);
  document.getElementById('search-close').addEventListener('click', MessageSearch.close);

  // Code action buttons (save/copy/rerun)
  document.getElementById('save-snippet-btn').addEventListener('click', SnippetLibrary.openSaveDialog);
  document.getElementById('copy-code-btn').addEventListener('click', SnippetLibrary.copyCurrentCode);
  document.getElementById('rerun-code-btn').addEventListener('click', SnippetLibrary.rerunCurrentCode);

  // Snippet save dialog
  document.getElementById('snippet-confirm-btn').addEventListener('click', SnippetLibrary.confirmSave);
  document.getElementById('snippet-cancel-btn').addEventListener('click', SnippetLibrary.closeSaveDialog);
  document.getElementById('snippet-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); SnippetLibrary.confirmSave(); }
  });

  // Snippets panel
  document.getElementById('snippets-btn').addEventListener('click', SnippetLibrary.toggle);
  document.getElementById('snippets-close-btn').addEventListener('click', SnippetLibrary.close);
  document.getElementById('snippets-overlay').addEventListener('click', SnippetLibrary.close);
  document.getElementById('snippets-search').addEventListener('input', SnippetLibrary.handleSearchDebounced);
  document.getElementById('snippets-clear-btn').addEventListener('click', SnippetLibrary.handleClearAll);

  // Sessions panel
  document.getElementById('sessions-btn').addEventListener('click', SessionManager.toggle);
  document.getElementById('sessions-close-btn').addEventListener('click', SessionManager.close);
  document.getElementById('sessions-overlay').addEventListener('click', SessionManager.close);
  document.getElementById('sessions-new-btn').addEventListener('click', SessionManager.newSession);
  document.getElementById('sessions-save-btn').addEventListener('click', SessionManager.openSaveDialog);
  document.getElementById('sessions-import-btn').addEventListener('click', SessionManager.handleImport);
  document.getElementById('sessions-clear-btn').addEventListener('click', SessionManager.handleClearAll);
  const tagsBtn = document.getElementById('sessions-tags-btn');
  if (tagsBtn) tagsBtn.addEventListener('click', ConversationTags.openManager);
  document.getElementById('sessions-autosave').addEventListener('change', SessionManager.toggleAutoSave);

  // Session save dialog
  document.getElementById('session-save-confirm').addEventListener('click', SessionManager.confirmSave);
  document.getElementById('session-save-cancel').addEventListener('click', SessionManager.closeSaveDialog);
  document.getElementById('session-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); SessionManager.confirmSave(); }
  });

  // Initialize session auto-save preference
  SessionManager.initAutoSave();

  // File drop zone
  FileDropZone.init();

  // Slash commands
  SlashCommands.init();

  // Message reactions
  MessageReactions.init();

  // Persona presets panel
  document.getElementById('persona-btn').addEventListener('click', PersonaPresets.toggle);
  document.getElementById('persona-close-btn').addEventListener('click', PersonaPresets.close);
  document.getElementById('persona-overlay').addEventListener('click', PersonaPresets.close);
  document.getElementById('persona-custom-apply').addEventListener('click', PersonaPresets.applyCustom);
  PersonaPresets.init();

  // Model selector
  document.getElementById('model-btn').addEventListener('click', ModelSelector.toggle);
  document.getElementById('model-close-btn').addEventListener('click', ModelSelector.close);
  document.getElementById('model-overlay').addEventListener('click', ModelSelector.close);
  ModelSelector.init();

  // Stats button
  document.getElementById('stats-btn').addEventListener('click', ChatStats.toggle);

  // Cost dashboard
  document.getElementById('cost-btn').addEventListener('click', CostDashboard.toggle);

  // Usage heatmap
  document.getElementById('heatmap-btn').addEventListener('click', UsageHeatmap.toggle);

  // Focus / Zen mode
  document.getElementById('zen-btn').addEventListener('click', FocusMode.toggle);
  FocusMode.init();

  // Formatting toolbar
  document.getElementById('fmt-btn').addEventListener('click', FormattingToolbar.toggle);

  // Scratchpad
  document.getElementById('scratchpad-btn').addEventListener('click', Scratchpad.toggle);
  document.getElementById('scratchpad-close-btn').addEventListener('click', Scratchpad.close);
  document.getElementById('scratchpad-overlay').addEventListener('click', Scratchpad.close);
  document.getElementById('scratchpad-textarea').addEventListener('input', Scratchpad._onInput);
  document.getElementById('scratchpad-copy-btn').addEventListener('click', Scratchpad.copy);
  document.getElementById('scratchpad-insert-btn').addEventListener('click', Scratchpad.insertToChat);
  document.getElementById('scratchpad-download-btn').addEventListener('click', Scratchpad.download);
  document.getElementById('scratchpad-clear-btn').addEventListener('click', Scratchpad.clear);

  // Message pinning
  MessagePinning.init();

  // ReadAloud (text-to-speech for messages)
  ReadAloud.init();

  // Message diff viewer
  MessageDiff.init();

  // Conversation timeline minimap
  ConversationTimeline.init();

  // Message annotations
  document.getElementById('annotations-btn').addEventListener('click', MessageAnnotations.togglePanel);
  MessageAnnotations.init();

  // Conversation chapters
  document.getElementById('chapters-btn').addEventListener('click', ConversationChapters.togglePanel);
  ConversationChapters.init();

  // Conversation summarizer
  document.getElementById('summary-btn').addEventListener('click', ConversationSummarizer.togglePanel);
  ConversationSummarizer.init();

  // Response rating
  document.getElementById('rating-btn').addEventListener('click', ResponseRating.toggleDashboard);
  ResponseRating.init();

  // Cross-tab sync (must come after SessionManager.initAutoSave)
  CrossTabSync.init();

  // Scheduled messages
  MessageScheduler.init();
  SmartRetry.init();
});


/* ---------- Conversation Summarizer ---------- */
/**
 * Extracts a structured summary from the current conversation using
 * text-analysis heuristics (no LLM call required). Identifies key topics,
 * decisions, questions asked, code snippets discussed, and action items.
 *
 * Public API:
 *   init()                   - inject styles, observe chat
 *   generateSummary()        - analyze conversation and return summary object
 *   openPanel() / closePanel() / togglePanel()
 *   getSummaryText()         - plain-text summary
 *   exportSummary(format)    - export as JSON or Markdown
 *   getTopics()              - extracted topic keywords
 *   getDecisions()           - detected decisions/conclusions
 *   getQuestions()           - questions asked during conversation
 *   getCodeBlocks()          - code snippets with language info
 *   getActionItems()         - detected action items / todos
 *   getStats()               - conversation statistics
 */
const ConversationSummarizer = (() => {
  'use strict';

  let panelEl = null;
  let overlayEl = null;
  let styleInjected = false;
  let lastSummary = null;

  // ── Stop words for topic extraction ──

  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'its', 'this', 'that', 'was',
    'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'not', 'no', 'nor', 'as', 'if', 'then', 'than', 'so', 'up', 'out',
    'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
    'just', 'because', 'also', 'any', 'much', 'what', 'which', 'who', 'whom',
    'these', 'those', 'am', 'we', 'they', 'you', 'he', 'she', 'me', 'him',
    'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'i', 'don',
    'doesn', 'didn', 'won', 'wouldn', 'couldn', 'shouldn', 'isn', 'aren',
    'wasn', 'weren', 'hasn', 'haven', 'hadn', 'let', 'get', 'got', 'like',
    'make', 'made', 'know', 'think', 'want', 'need', 'use', 'using', 'used',
    'one', 'two', 'new', 'way', 'well', 'still', 'even', 'back', 'over',
  ]);

  // ── Decision indicator patterns ──

  const DECISION_PATTERNS = [
    /\blet'?s\s+(go\s+with|use|choose|pick|stick\s+with|do)\b/i,
    /\b(decided|decision|conclusion|agreed|settled\s+on|going\s+with)\b/i,
    /\bwe('ll|\s+will|\s+should)\s+(use|go\s+with|implement|adopt)\b/i,
    /\b(best\s+(approach|option|choice|solution)|recommended)\b/i,
    /\b(in\s+summary|to\s+summarize|bottom\s+line|takeaway)\b/i,
  ];

  // ── Action item patterns ──

  const ACTION_PATTERNS = [
    /\b(todo|to-do|action\s+item|next\s+step|follow[\s-]up)\b/i,
    /\b(need\s+to|should|must|have\s+to|remember\s+to)\s+(\w+)/i,
    /\b(don'?t\s+forget\s+to|make\s+sure\s+to)\s+(\w+)/i,
    /\bstep\s+\d+[.:]\s*/i,
  ];

  // ── Styles ──

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '#summary-overlay {',
      '  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1050;',
      '  display: none;',
      '}',
      '#summary-overlay.sum-open { display: block; }',
      '#summary-panel {',
      '  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);',
      '  width: 520px; max-width: 92vw; max-height: 80vh; z-index: 1100;',
      '  background: var(--sum-bg, #0d1117); border: 1px solid var(--sum-border, #30363d);',
      '  border-radius: 12px; display: none; flex-direction: column; overflow: hidden;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '}',
      '#summary-panel.sum-open { display: flex; }',
      '#summary-header {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  padding: 14px 18px; border-bottom: 1px solid var(--sum-border, #30363d);',
      '}',
      '#summary-header h3 { margin: 0; color: #58a6ff; font-size: 15px; }',
      '#summary-header-actions { display: flex; gap: 6px; }',
      '#summary-header-actions button {',
      '  background: #21262d; border: 1px solid #30363d; color: #c9d1d9;',
      '  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;',
      '}',
      '#summary-header-actions button:hover { background: #30363d; }',
      '#summary-body {',
      '  flex: 1; overflow-y: auto; padding: 12px 18px;',
      '}',
      '.sum-section { margin-bottom: 16px; }',
      '.sum-section-title {',
      '  font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase;',
      '  letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;',
      '}',
      '.sum-section-title .sum-icon { font-size: 14px; }',
      '.sum-topic-chips { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.sum-chip {',
      '  display: inline-flex; align-items: center; gap: 4px;',
      '  padding: 3px 10px; border-radius: 12px; font-size: 12px;',
      '  background: #1c2333; border: 1px solid #30363d; color: #c9d1d9;',
      '}',
      '.sum-chip-count {',
      '  font-size: 10px; color: #6e7681; font-weight: 600;',
      '}',
      '.sum-list { list-style: none; padding: 0; margin: 0; }',
      '.sum-list li {',
      '  padding: 6px 10px; margin-bottom: 4px; border-radius: 6px;',
      '  background: #161b22; font-size: 13px; color: #c9d1d9; line-height: 1.5;',
      '}',
      '.sum-list li .sum-role {',
      '  font-size: 10px; font-weight: 600; color: #6e7681; margin-right: 6px;',
      '}',
      '.sum-stats {',
      '  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));',
      '  gap: 8px;',
      '}',
      '.sum-stat {',
      '  background: #161b22; border-radius: 8px; padding: 10px 12px; text-align: center;',
      '}',
      '.sum-stat-value { font-size: 20px; font-weight: 700; color: #58a6ff; }',
      '.sum-stat-label { font-size: 11px; color: #6e7681; margin-top: 2px; }',
      '.sum-code-item {',
      '  padding: 8px 10px; margin-bottom: 6px; border-radius: 6px;',
      '  background: #161b22; border-left: 3px solid #f0883e;',
      '}',
      '.sum-code-lang {',
      '  font-size: 10px; font-weight: 700; color: #f0883e; text-transform: uppercase;',
      '  margin-bottom: 4px;',
      '}',
      '.sum-code-preview {',
      '  font-family: monospace; font-size: 11px; color: #8b949e;',
      '  white-space: pre; overflow: hidden; text-overflow: ellipsis; max-height: 40px;',
      '}',
      '.sum-empty {',
      '  color: #6e7681; font-size: 13px; text-align: center; padding: 32px 16px;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Analysis helpers ──

  function getMessages() {
    if (typeof ConversationManager !== 'undefined') {
      return ConversationManager.getMessages().filter(function(m) {
        return m.role !== 'system';
      });
    }
    return [];
  }

  /**
   * Extract top keywords from text using term frequency.
   * @param {string} text       Combined text to analyze.
   * @param {number} [maxTopics]  Maximum topics to return.
   * @returns {Array<{word: string, count: number}>}
   */
  function extractTopics(text, maxTopics) {
    maxTopics = maxTopics || 10;
    var words = text.toLowerCase().replace(/[^a-z0-9\s\-_]/g, ' ').split(/\s+/);
    var freq = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3 || STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    return Object.keys(freq)
      .filter(function(k) { return freq[k] >= 2; })
      .sort(function(a, b) { return freq[b] - freq[a]; })
      .slice(0, maxTopics)
      .map(function(k) { return { word: k, count: freq[k] }; });
  }

  /**
   * Extract questions from messages.
   * @param {Array} messages  Conversation messages.
   * @returns {Array<{role: string, text: string}>}
   */
  function extractQuestions(messages) {
    var questions = [];
    for (var i = 0; i < messages.length; i++) {
      var lines = (messages[i].content || '').split('\n');
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        if (line.endsWith('?') && line.length > 5 && line.length < 200) {
          // Strip markdown formatting
          var clean = line.replace(/^[#*>\-\s]+/, '').replace(/[*_`~\[\]]/g, '').trim();
          if (clean.length > 5) {
            questions.push({ role: messages[i].role, text: clean });
          }
        }
      }
    }
    return questions.slice(0, 20);
  }

  /**
   * Extract code blocks from messages.
   * @param {Array} messages  Conversation messages.
   * @returns {Array<{language: string, preview: string, role: string, lines: number}>}
   */
  function extractCodeBlocks(messages) {
    var blocks = [];
    var codeRegex = /```(\w*)\n?([\s\S]*?)```/g;
    for (var i = 0; i < messages.length; i++) {
      var content = messages[i].content || '';
      var match;
      while ((match = codeRegex.exec(content)) !== null) {
        var lang = match[1] || 'text';
        var code = match[2].trim();
        var codeLines = code.split('\n');
        blocks.push({
          language: lang,
          preview: codeLines.slice(0, 3).join('\n'),
          role: messages[i].role,
          lines: codeLines.length,
        });
      }
    }
    return blocks.slice(0, 15);
  }

  /**
   * Detect sentences that look like decisions or conclusions.
   * @param {Array} messages  Conversation messages.
   * @returns {Array<{role: string, text: string}>}
   */
  function extractDecisions(messages) {
    var decisions = [];
    for (var i = 0; i < messages.length; i++) {
      var sentences = (messages[i].content || '')
        .replace(/```[\s\S]*?```/g, '')
        .split(/[.!]\s+|\n/);
      for (var s = 0; s < sentences.length; s++) {
        var sent = sentences[s].trim();
        if (sent.length < 10 || sent.length > 200) continue;
        for (var p = 0; p < DECISION_PATTERNS.length; p++) {
          if (DECISION_PATTERNS[p].test(sent)) {
            var clean = sent.replace(/[#*_`~\[\]]/g, '').trim();
            if (clean.length > 10) {
              decisions.push({ role: messages[i].role, text: clean });
            }
            break;
          }
        }
      }
    }
    return decisions.slice(0, 10);
  }

  /**
   * Detect action items and todos.
   * @param {Array} messages  Conversation messages.
   * @returns {Array<{role: string, text: string}>}
   */
  function extractActionItems(messages) {
    var items = [];
    for (var i = 0; i < messages.length; i++) {
      var lines = (messages[i].content || '')
        .replace(/```[\s\S]*?```/g, '')
        .split('\n');
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        if (line.length < 8 || line.length > 200) continue;
        for (var p = 0; p < ACTION_PATTERNS.length; p++) {
          if (ACTION_PATTERNS[p].test(line)) {
            var clean = line.replace(/^[\s\-*>#\d.]+/, '').replace(/[*_`~\[\]]/g, '').trim();
            if (clean.length > 5) {
              items.push({ role: messages[i].role, text: clean });
            }
            break;
          }
        }
      }
    }
    // Deduplicate by text similarity
    var seen = {};
    var unique = [];
    for (var u = 0; u < items.length; u++) {
      var key = items[u].text.toLowerCase().substring(0, 50);
      if (!seen[key]) {
        seen[key] = true;
        unique.push(items[u]);
      }
    }
    return unique.slice(0, 15);
  }

  /**
   * Compute conversation statistics.
   * @param {Array} messages  Conversation messages.
   * @returns {object}
   */
  function computeStats(messages) {
    var totalWords = 0;
    var userWords = 0;
    var assistantWords = 0;
    var userMsgCount = 0;
    var assistantMsgCount = 0;
    var codeBlockCount = 0;
    var longestMsg = 0;

    for (var i = 0; i < messages.length; i++) {
      var content = messages[i].content || '';
      var words = content.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
      totalWords += words;
      if (words > longestMsg) longestMsg = words;

      if (messages[i].role === 'user') {
        userWords += words;
        userMsgCount++;
      } else if (messages[i].role === 'assistant') {
        assistantWords += words;
        assistantMsgCount++;
      }

      var codeMatches = content.match(/```/g);
      if (codeMatches) codeBlockCount += Math.floor(codeMatches.length / 2);
    }

    return {
      totalMessages: messages.length,
      userMessages: userMsgCount,
      assistantMessages: assistantMsgCount,
      totalWords: totalWords,
      userWords: userWords,
      assistantWords: assistantWords,
      codeBlocks: codeBlockCount,
      longestMessage: longestMsg,
      avgWordsPerMessage: messages.length > 0 ? Math.round(totalWords / messages.length) : 0,
      readingTimeMin: Math.max(1, Math.round(totalWords / 238)),
    };
  }

  // ── Core: Generate Summary ──

  function generateSummary() {
    var messages = getMessages();
    if (messages.length === 0) {
      lastSummary = null;
      return null;
    }

    var allText = messages.map(function(m) { return m.content || ''; }).join(' ');

    lastSummary = {
      generatedAt: Date.now(),
      messageCount: messages.length,
      topics: extractTopics(allText),
      questions: extractQuestions(messages),
      codeBlocks: extractCodeBlocks(messages),
      decisions: extractDecisions(messages),
      actionItems: extractActionItems(messages),
      stats: computeStats(messages),
    };

    return lastSummary;
  }

  // ── Getters ──

  function getTopics() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.topics : [];
  }

  function getDecisions() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.decisions : [];
  }

  function getQuestions() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.questions : [];
  }

  function getCodeBlocks() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.codeBlocks : [];
  }

  function getActionItems() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.actionItems : [];
  }

  function getStats() {
    if (!lastSummary) generateSummary();
    return lastSummary ? lastSummary.stats : null;
  }

  // ── Export ──

  function getSummaryText() {
    var sum = lastSummary || generateSummary();
    if (!sum) return 'No conversation to summarize.';

    var lines = ['# Conversation Summary', ''];

    // Stats
    var s = sum.stats;
    lines.push('## Overview');
    lines.push('- **Messages:** ' + s.totalMessages + ' (' + s.userMessages + ' user, ' + s.assistantMessages + ' assistant)');
    lines.push('- **Words:** ' + s.totalWords.toLocaleString() + ' (~' + s.readingTimeMin + ' min read)');
    lines.push('- **Code blocks:** ' + s.codeBlocks);
    lines.push('');

    // Topics
    if (sum.topics.length > 0) {
      lines.push('## Key Topics');
      for (var t = 0; t < sum.topics.length; t++) {
        lines.push('- **' + sum.topics[t].word + '** (' + sum.topics[t].count + ' mentions)');
      }
      lines.push('');
    }

    // Questions
    if (sum.questions.length > 0) {
      lines.push('## Questions Asked');
      for (var q = 0; q < sum.questions.length; q++) {
        lines.push('- [' + sum.questions[q].role + '] ' + sum.questions[q].text);
      }
      lines.push('');
    }

    // Decisions
    if (sum.decisions.length > 0) {
      lines.push('## Decisions & Conclusions');
      for (var d = 0; d < sum.decisions.length; d++) {
        lines.push('- ' + sum.decisions[d].text);
      }
      lines.push('');
    }

    // Action Items
    if (sum.actionItems.length > 0) {
      lines.push('## Action Items');
      for (var a = 0; a < sum.actionItems.length; a++) {
        lines.push('- [ ] ' + sum.actionItems[a].text);
      }
      lines.push('');
    }

    // Code
    if (sum.codeBlocks.length > 0) {
      lines.push('## Code Discussed');
      for (var c = 0; c < sum.codeBlocks.length; c++) {
        var block = sum.codeBlocks[c];
        lines.push('- **' + block.language + '** (' + block.lines + ' lines, by ' + block.role + ')');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function exportSummary(format) {
    var sum = lastSummary || generateSummary();
    if (!sum) return '';
    if (format === 'json') return JSON.stringify(sum, null, 2);
    return getSummaryText();
  }

  // ── Panel UI ──

  function buildPanel() {
    if (panelEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'summary-overlay';
    overlayEl.addEventListener('click', closePanel);
    document.body.appendChild(overlayEl);

    panelEl = document.createElement('div');
    panelEl.id = 'summary-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Conversation Summary');

    // Header
    var header = document.createElement('div');
    header.id = 'summary-header';
    var h3 = document.createElement('h3');
    h3.textContent = '📋 Summary';
    header.appendChild(h3);

    var actions = document.createElement('div');
    actions.id = 'summary-header-actions';

    var refreshBtn = document.createElement('button');
    refreshBtn.textContent = '🔄 Refresh';
    refreshBtn.title = 'Regenerate summary';
    refreshBtn.addEventListener('click', function() {
      generateSummary();
      renderPanel();
    });
    actions.appendChild(refreshBtn);

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy';
    copyBtn.title = 'Copy summary as Markdown';
    copyBtn.addEventListener('click', function() {
      try {
        navigator.clipboard.writeText(getSummaryText());
        copyBtn.textContent = '✓ Copied';
        setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
      } catch (_) { /* ignore */ }
    });
    actions.appendChild(copyBtn);

    var jsonBtn = document.createElement('button');
    jsonBtn.textContent = '{ } JSON';
    jsonBtn.title = 'Download summary as JSON';
    jsonBtn.addEventListener('click', function() {
      var json = exportSummary('json');
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'conversation-summary.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    actions.appendChild(jsonBtn);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', closePanel);
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    panelEl.appendChild(header);

    // Body
    var body = document.createElement('div');
    body.id = 'summary-body';
    panelEl.appendChild(body);

    document.body.appendChild(panelEl);
  }

  function renderPanel() {
    var body = document.getElementById('summary-body');
    if (!body) return;
    body.innerHTML = '';

    var sum = lastSummary || generateSummary();
    if (!sum) {
      body.innerHTML = '<div class="sum-empty">Start a conversation to see its summary here.</div>';
      return;
    }

    // Stats section
    var statsSection = _createSection('📊', 'Statistics');
    var statsGrid = document.createElement('div');
    statsGrid.className = 'sum-stats';
    var statItems = [
      { value: sum.stats.totalMessages, label: 'Messages' },
      { value: sum.stats.totalWords.toLocaleString(), label: 'Words' },
      { value: sum.stats.codeBlocks, label: 'Code Blocks' },
      { value: sum.stats.readingTimeMin + 'm', label: 'Reading Time' },
      { value: sum.stats.avgWordsPerMessage, label: 'Avg Words/Msg' },
      { value: sum.stats.longestMessage.toLocaleString(), label: 'Longest Msg' },
    ];
    for (var i = 0; i < statItems.length; i++) {
      var stat = document.createElement('div');
      stat.className = 'sum-stat';
      var val = document.createElement('div');
      val.className = 'sum-stat-value';
      val.textContent = statItems[i].value;
      stat.appendChild(val);
      var lbl = document.createElement('div');
      lbl.className = 'sum-stat-label';
      lbl.textContent = statItems[i].label;
      stat.appendChild(lbl);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    body.appendChild(statsSection);

    // Topics section
    if (sum.topics.length > 0) {
      var topicSection = _createSection('🏷️', 'Key Topics');
      var chips = document.createElement('div');
      chips.className = 'sum-topic-chips';
      for (var t = 0; t < sum.topics.length; t++) {
        var chip = document.createElement('span');
        chip.className = 'sum-chip';
        chip.textContent = sum.topics[t].word;
        var cnt = document.createElement('span');
        cnt.className = 'sum-chip-count';
        cnt.textContent = '×' + sum.topics[t].count;
        chip.appendChild(cnt);
        chips.appendChild(chip);
      }
      topicSection.appendChild(chips);
      body.appendChild(topicSection);
    }

    // Questions section
    if (sum.questions.length > 0) {
      var qSection = _createSection('❓', 'Questions (' + sum.questions.length + ')');
      var qList = document.createElement('ul');
      qList.className = 'sum-list';
      for (var q = 0; q < sum.questions.length; q++) {
        var li = document.createElement('li');
        var role = document.createElement('span');
        role.className = 'sum-role';
        role.textContent = sum.questions[q].role;
        li.appendChild(role);
        li.appendChild(document.createTextNode(sum.questions[q].text));
        qList.appendChild(li);
      }
      qSection.appendChild(qList);
      body.appendChild(qSection);
    }

    // Decisions section
    if (sum.decisions.length > 0) {
      var dSection = _createSection('✅', 'Decisions (' + sum.decisions.length + ')');
      var dList = document.createElement('ul');
      dList.className = 'sum-list';
      for (var d = 0; d < sum.decisions.length; d++) {
        var dli = document.createElement('li');
        dli.textContent = sum.decisions[d].text;
        dList.appendChild(dli);
      }
      dSection.appendChild(dList);
      body.appendChild(dSection);
    }

    // Action Items section
    if (sum.actionItems.length > 0) {
      var aSection = _createSection('☑️', 'Action Items (' + sum.actionItems.length + ')');
      var aList = document.createElement('ul');
      aList.className = 'sum-list';
      for (var a = 0; a < sum.actionItems.length; a++) {
        var ali = document.createElement('li');
        ali.textContent = sum.actionItems[a].text;
        aList.appendChild(ali);
      }
      aSection.appendChild(aList);
      body.appendChild(aSection);
    }

    // Code blocks section
    if (sum.codeBlocks.length > 0) {
      var cSection = _createSection('💻', 'Code Discussed (' + sum.codeBlocks.length + ')');
      for (var c = 0; c < sum.codeBlocks.length; c++) {
        var block = sum.codeBlocks[c];
        var item = document.createElement('div');
        item.className = 'sum-code-item';
        var langLabel = document.createElement('div');
        langLabel.className = 'sum-code-lang';
        langLabel.textContent = block.language + ' · ' + block.lines + ' lines · ' + block.role;
        item.appendChild(langLabel);
        var preview = document.createElement('div');
        preview.className = 'sum-code-preview';
        preview.textContent = block.preview;
        item.appendChild(preview);
        cSection.appendChild(item);
      }
      body.appendChild(cSection);
    }
  }

  function _createSection(icon, title) {
    var section = document.createElement('div');
    section.className = 'sum-section';
    var titleEl = document.createElement('div');
    titleEl.className = 'sum-section-title';
    var iconSpan = document.createElement('span');
    iconSpan.className = 'sum-icon';
    iconSpan.textContent = icon;
    titleEl.appendChild(iconSpan);
    titleEl.appendChild(document.createTextNode(title));
    section.appendChild(titleEl);
    return section;
  }

  function openPanel() {
    buildPanel();
    generateSummary();
    renderPanel();
    panelEl.classList.add('sum-open');
    overlayEl.classList.add('sum-open');
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('sum-open');
    if (overlayEl) overlayEl.classList.remove('sum-open');
  }

  function togglePanel() {
    if (panelEl && panelEl.classList.contains('sum-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ── Init ──

  function init() {
    injectStyles();

    // Keyboard shortcut: Alt+S to toggle summary
    document.addEventListener('keydown', function(e) {
      if (e.altKey && e.key === 's' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  return {
    init: init,
    generateSummary: generateSummary,
    openPanel: openPanel,
    closePanel: closePanel,
    togglePanel: togglePanel,
    getSummaryText: getSummaryText,
    exportSummary: exportSummary,
    getTopics: getTopics,
    getDecisions: getDecisions,
    getQuestions: getQuestions,
    getCodeBlocks: getCodeBlocks,
    getActionItems: getActionItems,
    getStats: getStats,
    // Expose internals for testing
    _extractTopics: extractTopics,
    _extractQuestions: extractQuestions,
    _extractCodeBlocks: extractCodeBlocks,
    _extractDecisions: extractDecisions,
    _extractActionItems: extractActionItems,
    _computeStats: computeStats,
  };
})();


/* ============================================================
 * MessageAnnotations — private notes and annotations on messages.
 *
 * Lets users attach personal notes to any message in the conversation.
 * Each annotation has a text body (up to 500 chars) and one of six
 * labels: Note, Important, Correction, Question, To-Do, Reference.
 * Annotations persist in localStorage and display as coloured badges
 * on decorated messages, with a slide-out panel for editing.
 *
 * Supports: create, edit, delete, bulk export, label filtering,
 * and a summary view listing all annotated messages.  Limited to
 * 200 annotations per session to keep storage bounded.
 *
 * @namespace MessageAnnotations
 * ============================================================ */
const MessageAnnotations = (() => {
  'use strict';

  const STORAGE_KEY = 'agenticchat_annotations';
  const MAX_NOTE_LENGTH = 500;
  const MAX_ANNOTATIONS = 200;

  const LABELS = [
    { id: 'note',      name: 'Note',       color: '#38bdf8', icon: '📝' },
    { id: 'important', name: 'Important',   color: '#f59e0b', icon: '⭐' },
    { id: 'correction',name: 'Correction',  color: '#ef4444', icon: '✏️' },
    { id: 'question',  name: 'Question',    color: '#a78bfa', icon: '❓' },
    { id: 'todo',      name: 'To-Do',       color: '#22c55e', icon: '☑️' },
    { id: 'reference', name: 'Reference',   color: '#64748b', icon: '🔗' },
  ];

  // annotations: { [messageIndex]: { text, label, createdAt, updatedAt } }
  let annotations = {};
  let panelEl = null;
  let overlayEl = null;
  let styleInjected = false;

  // ── Styles ──

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '.ann-badge {',
      '  position: absolute; top: 4px; right: 4px; width: 22px; height: 22px;',
      '  border-radius: 50%; display: flex; align-items: center; justify-content: center;',
      '  font-size: 12px; cursor: pointer; opacity: 0.7; transition: opacity 0.15s;',
      '  z-index: 5; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);',
      '}',
      '.ann-badge:hover { opacity: 1; }',
      '.ann-tooltip {',
      '  position: absolute; top: 28px; right: 0; z-index: 100;',
      '  background: #1a2332; border: 1px solid #2d4a6f; border-radius: 6px;',
      '  padding: 8px 10px; font-size: 12px; color: #c9d1d9; max-width: 260px;',
      '  word-wrap: break-word; box-shadow: 0 4px 12px rgba(0,0,0,0.4);',
      '  display: none;',
      '}',
      '.ann-tooltip.visible { display: block; }',
      '.ann-label-dot {',
      '  display: inline-block; width: 8px; height: 8px; border-radius: 50%;',
      '  margin-right: 5px; vertical-align: middle;',
      '}',
      '.ann-add-btn {',
      '  position: absolute; top: 4px; right: 30px; width: 22px; height: 22px;',
      '  border-radius: 50%; display: flex; align-items: center; justify-content: center;',
      '  font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.15s;',
      '  z-index: 5; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);',
      '  color: #888;',
      '}',
      '.chat-msg { position: relative; }',
      '.chat-msg:hover .ann-add-btn { opacity: 0.6; }',
      '.chat-msg:hover .ann-add-btn:hover { opacity: 1; }',
      '#ann-panel {',
      '  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);',
      '  width: 480px; max-width: 90vw; max-height: 70vh; z-index: 1100;',
      '  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;',
      '  display: none; flex-direction: column; overflow: hidden;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '}',
      '#ann-panel.ann-open { display: flex; }',
      '#ann-panel-header {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  padding: 12px 16px; border-bottom: 1px solid #30363d;',
      '}',
      '#ann-panel-header h3 { margin: 0; color: #38bdf8; font-size: 15px; }',
      '#ann-panel-body {',
      '  flex: 1; overflow-y: auto; padding: 8px 12px;',
      '}',
      '#ann-panel-footer {',
      '  display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid #30363d;',
      '}',
      '#ann-panel-footer button {',
      '  background: #21262d; border: 1px solid #30363d; color: #c9d1d9;',
      '  padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;',
      '}',
      '#ann-panel-footer button:hover { background: #30363d; }',
      '.ann-item {',
      '  display: flex; gap: 8px; padding: 8px; border-radius: 6px;',
      '  margin-bottom: 6px; background: #161b22; cursor: pointer;',
      '}',
      '.ann-item:hover { background: #1c2333; }',
      '.ann-item-label { font-size: 11px; font-weight: 600; }',
      '.ann-item-text { font-size: 12px; color: #c9d1d9; flex: 1; }',
      '.ann-item-meta { font-size: 10px; color: #6e7681; }',
      '.ann-item-actions { display: flex; gap: 4px; align-items: flex-start; }',
      '.ann-item-actions button {',
      '  background: none; border: none; color: #6e7681; cursor: pointer;',
      '  font-size: 11px; padding: 2px 4px;',
      '}',
      '.ann-item-actions button:hover { color: #c9d1d9; }',
      '#ann-overlay {',
      '  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1050;',
      '  display: none;',
      '}',
      '#ann-overlay.ann-open { display: block; }',
      '.ann-editor {',
      '  position: fixed; z-index: 1200; background: #0d1117; border: 1px solid #30363d;',
      '  border-radius: 8px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);',
      '  width: 320px; max-width: 90vw;',
      '}',
      '.ann-editor textarea {',
      '  width: 100%; height: 80px; background: #161b22; border: 1px solid #30363d;',
      '  border-radius: 4px; color: #c9d1d9; padding: 6px 8px; font-size: 12px;',
      '  resize: vertical; font-family: inherit;',
      '}',
      '.ann-editor-labels { display: flex; gap: 4px; margin: 8px 0; flex-wrap: wrap; }',
      '.ann-editor-labels button {',
      '  padding: 3px 8px; border-radius: 12px; font-size: 11px; cursor: pointer;',
      '  border: 1px solid transparent; background: #21262d; color: #c9d1d9;',
      '}',
      '.ann-editor-labels button.selected { border-color: currentColor; }',
      '.ann-editor-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }',
      '.ann-editor-actions button {',
      '  padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;',
      '  border: 1px solid #30363d;',
      '}',
      '.ann-editor-save { background: #238636 !important; color: #fff !important; border-color: #2ea043 !important; }',
      '.ann-editor-cancel { background: #21262d; color: #c9d1d9; }',
      '.ann-editor-delete { background: #da3633 !important; color: #fff !important; border-color: #f85149 !important; }',
      '.ann-count { font-size: 10px; color: #6e7681; margin-left: 4px; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Persistence ──

  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) {
        annotations = sanitizeStorageObject(JSON.parse(raw));
      }
    } catch (_) {
      annotations = {};
    }
  }

  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(annotations));
    } catch (_) { /* quota exceeded or storage revoked */ }
  }

  // ── Core API ──

  function addAnnotation(messageIndex, text, labelId) {
    if (typeof messageIndex !== 'number' || messageIndex < 0) return null;
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_NOTE_LENGTH) return null;
    if (Object.keys(annotations).length >= MAX_ANNOTATIONS && !annotations[messageIndex]) return null;

    const label = LABELS.find(l => l.id === labelId) || LABELS[0];
    const now = new Date().toISOString();

    annotations[messageIndex] = {
      text: trimmed,
      label: label.id,
      createdAt: annotations[messageIndex] ? annotations[messageIndex].createdAt : now,
      updatedAt: now,
    };

    save();
    return getAnnotation(messageIndex);
  }

  function removeAnnotation(messageIndex) {
    if (!annotations[messageIndex]) return false;
    delete annotations[messageIndex];
    save();
    return true;
  }

  function getAnnotation(messageIndex) {
    const ann = annotations[messageIndex];
    if (!ann) return null;
    return Object.assign({}, ann, { messageIndex: messageIndex });
  }

  function getAllAnnotations() {
    return Object.keys(annotations).map(key => {
      const idx = parseInt(key, 10);
      return Object.assign({}, annotations[key], { messageIndex: idx });
    }).sort((a, b) => a.messageIndex - b.messageIndex);
  }

  function getCount() {
    return Object.keys(annotations).length;
  }

  function hasAnnotation(messageIndex) {
    return !!annotations[messageIndex];
  }

  function clearAll() {
    const count = getCount();
    annotations = {};
    save();
    return count;
  }

  function getLabels() {
    return LABELS.map(l => Object.assign({}, l));
  }

  function exportAnnotations() {
    const all = getAllAnnotations();
    const messages = typeof ConversationManager !== 'undefined'
      ? ConversationManager.getMessages().filter(m => m.role !== 'system')
      : [];

    return all.map(ann => {
      const domIndex = ann.messageIndex - 1;
      const msg = messages[domIndex];
      const label = LABELS.find(l => l.id === ann.label) || LABELS[0];
      return {
        messageIndex: ann.messageIndex,
        messagePreview: msg ? msg.content.substring(0, 120) : '(unavailable)',
        messageRole: msg ? msg.role : 'unknown',
        label: label.name,
        note: ann.text,
        createdAt: ann.createdAt,
        updatedAt: ann.updatedAt,
      };
    });
  }

  // ── UI: Badge + Tooltip on messages ──

  function renderBadges() {
    const output = document.getElementById('chat-output');
    if (!output) return;
    const msgs = output.querySelectorAll('.chat-msg');

    msgs.forEach((msgEl, domIdx) => {
      const msgIndex = domIdx + 1; // skip system prompt at [0]

      // Ensure add button exists
      let addBtn = msgEl.querySelector('.ann-add-btn');
      if (!addBtn) {
        addBtn = document.createElement('button');
        addBtn.className = 'ann-add-btn';
        addBtn.textContent = '📝';
        addBtn.title = 'Add annotation';
        addBtn.setAttribute('aria-label', 'Add annotation');
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(msgIndex, msgEl);
        });
        msgEl.appendChild(addBtn);
      }

      // Remove existing badge/tooltip
      const existing = msgEl.querySelector('.ann-badge');
      if (existing) existing.remove();
      const existingTip = msgEl.querySelector('.ann-tooltip');
      if (existingTip) existingTip.remove();

      const ann = annotations[msgIndex];
      if (!ann) return;

      const label = LABELS.find(l => l.id === ann.label) || LABELS[0];

      const badge = document.createElement('span');
      badge.className = 'ann-badge';
      badge.textContent = label.icon;
      badge.title = label.name + ': ' + ann.text.substring(0, 60);
      badge.style.borderColor = label.color;
      badge.setAttribute('aria-label', 'Annotation: ' + label.name);
      badge.tabIndex = 0;

      const tooltip = document.createElement('div');
      tooltip.className = 'ann-tooltip';
      tooltip.setAttribute('role', 'tooltip');

      const dot = document.createElement('span');
      dot.className = 'ann-label-dot';
      dot.style.backgroundColor = label.color;
      tooltip.appendChild(dot);

      const labelSpan = document.createElement('strong');
      labelSpan.textContent = label.name;
      labelSpan.style.color = label.color;
      tooltip.appendChild(labelSpan);

      tooltip.appendChild(document.createElement('br'));

      const textSpan = document.createElement('span');
      textSpan.textContent = ann.text;
      tooltip.appendChild(textSpan);

      const editLink = document.createElement('div');
      editLink.style.cssText = 'margin-top:6px;font-size:11px;';
      editLink.innerHTML = '<a href="#" style="color:#38bdf8;text-decoration:none;">Edit</a>';
      editLink.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tooltip.classList.remove('visible');
        openEditor(msgIndex, msgEl);
      });
      tooltip.appendChild(editLink);

      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.classList.toggle('visible');
      });
      badge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tooltip.classList.toggle('visible');
        }
      });

      msgEl.appendChild(badge);
      msgEl.appendChild(tooltip);

      // Hide add btn if annotation exists (badge replaces it visually)
      addBtn.style.right = '30px';
    });
  }

  // ── UI: Inline Editor ──

  let editorEl = null;

  function openEditor(messageIndex, anchorEl) {
    closeEditor();

    const existing = annotations[messageIndex];
    const currentLabel = existing ? existing.label : 'note';
    const currentText = existing ? existing.text : '';

    editorEl = document.createElement('div');
    editorEl.className = 'ann-editor';
    editorEl.setAttribute('role', 'dialog');
    editorEl.setAttribute('aria-label', 'Annotation editor');

    // Position near the message
    const rect = anchorEl.getBoundingClientRect();
    editorEl.style.top = Math.max(8, rect.top) + 'px';
    editorEl.style.left = Math.min(window.innerWidth - 340, Math.max(8, rect.right + 8)) + 'px';

    const textarea = document.createElement('textarea');
    textarea.value = currentText;
    textarea.placeholder = 'Add a note about this message...';
    textarea.maxLength = MAX_NOTE_LENGTH;
    textarea.setAttribute('aria-label', 'Annotation text');
    editorEl.appendChild(textarea);

    // Label buttons
    const labelsDiv = document.createElement('div');
    labelsDiv.className = 'ann-editor-labels';
    let selectedLabel = currentLabel;

    LABELS.forEach(label => {
      const btn = document.createElement('button');
      btn.textContent = label.icon + ' ' + label.name;
      btn.style.color = label.color;
      if (label.id === selectedLabel) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        selectedLabel = label.id;
        labelsDiv.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      labelsDiv.appendChild(btn);
    });
    editorEl.appendChild(labelsDiv);

    // Action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'ann-editor-actions';

    if (existing) {
      const delBtn = document.createElement('button');
      delBtn.className = 'ann-editor-delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        removeAnnotation(messageIndex);
        closeEditor();
        renderBadges();
        renderPanel();
      });
      actionsDiv.appendChild(delBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ann-editor-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeEditor);
    actionsDiv.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ann-editor-save';
    saveBtn.textContent = existing ? 'Update' : 'Save';
    saveBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) return;
      addAnnotation(messageIndex, text, selectedLabel);
      closeEditor();
      renderBadges();
      renderPanel();
    });
    actionsDiv.appendChild(saveBtn);
    editorEl.appendChild(actionsDiv);

    document.body.appendChild(editorEl);
    textarea.focus();

    // Close on Escape
    editorEl._keyHandler = (e) => {
      if (e.key === 'Escape') closeEditor();
    };
    document.addEventListener('keydown', editorEl._keyHandler);
  }

  function closeEditor() {
    if (editorEl) {
      if (editorEl._keyHandler) {
        document.removeEventListener('keydown', editorEl._keyHandler);
      }
      editorEl.remove();
      editorEl = null;
    }
  }

  // ── UI: Panel ──

  function buildPanel() {
    if (panelEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'ann-overlay';
    overlayEl.addEventListener('click', closePanel);
    document.body.appendChild(overlayEl);

    panelEl = document.createElement('div');
    panelEl.id = 'ann-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Message annotations');

    const header = document.createElement('div');
    header.id = 'ann-panel-header';

    const title = document.createElement('h3');
    title.textContent = '📝 Annotations';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);

    panelEl.appendChild(header);

    const body = document.createElement('div');
    body.id = 'ann-panel-body';
    panelEl.appendChild(body);

    const footer = document.createElement('div');
    footer.id = 'ann-panel-footer';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇ Export JSON';
    exportBtn.addEventListener('click', () => {
      const data = exportAnnotations();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotations.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    footer.appendChild(exportBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear All';
    clearBtn.addEventListener('click', () => {
      if (getCount() === 0) return;
      clearAll();
      renderPanel();
      renderBadges();
    });
    footer.appendChild(clearBtn);

    panelEl.appendChild(footer);
    document.body.appendChild(panelEl);
  }

  function renderPanel() {
    if (!panelEl) return;
    const body = panelEl.querySelector('#ann-panel-body');
    if (!body) return;
    body.innerHTML = '';

    const all = getAllAnnotations();
    if (all.length === 0) {
      body.innerHTML = '<div style="padding:16px;color:#6e7681;text-align:center;">No annotations yet.<br>Click 📝 on any message to add one.</div>';
      return;
    }

    const messages = typeof ConversationManager !== 'undefined'
      ? ConversationManager.getMessages().filter(m => m.role !== 'system')
      : [];

    all.forEach(ann => {
      const domIndex = ann.messageIndex - 1;
      const msg = messages[domIndex];
      const label = LABELS.find(l => l.id === ann.label) || LABELS[0];

      const item = document.createElement('div');
      item.className = 'ann-item';
      item.title = 'Click to jump to message';
      item.addEventListener('click', () => {
        closePanel();
        jumpToMessage(ann.messageIndex);
      });

      const content = document.createElement('div');
      content.style.cssText = 'flex:1;min-width:0;';

      const labelSpan = document.createElement('div');
      labelSpan.className = 'ann-item-label';
      labelSpan.style.color = label.color;
      labelSpan.textContent = label.icon + ' ' + label.name;
      content.appendChild(labelSpan);

      const textDiv = document.createElement('div');
      textDiv.className = 'ann-item-text';
      textDiv.textContent = ann.text;
      content.appendChild(textDiv);

      const meta = document.createElement('div');
      meta.className = 'ann-item-meta';
      const preview = msg ? msg.content.substring(0, 80) : '(message unavailable)';
      const role = msg ? msg.role : '?';
      meta.textContent = role + ': "' + preview + (preview.length >= 80 ? '…' : '') + '"';
      content.appendChild(meta);

      item.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'ann-item-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePanel();
        // Find message element to anchor editor
        const output = document.getElementById('chat-output');
        if (output) {
          const allMsgs = output.querySelectorAll('.chat-msg');
          const el = allMsgs[domIndex];
          if (el) openEditor(ann.messageIndex, el);
        }
      });
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAnnotation(ann.messageIndex);
        renderPanel();
        renderBadges();
      });
      actions.appendChild(delBtn);

      item.appendChild(actions);
      body.appendChild(item);
    });
  }

  function jumpToMessage(messageIndex) {
    const output = document.getElementById('chat-output');
    if (!output) return;
    const allMsgs = output.querySelectorAll('.chat-msg');
    const domIndex = messageIndex - 1;
    if (domIndex >= 0 && domIndex < allMsgs.length) {
      const target = allMsgs[domIndex];
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const orig = target.style.outline;
      target.style.outline = '2px solid #38bdf8';
      target.style.outlineOffset = '2px';
      setTimeout(() => {
        target.style.outline = orig;
        target.style.outlineOffset = '';
      }, 1500);
    }
  }

  function openPanel() {
    buildPanel();
    renderPanel();
    panelEl.classList.add('ann-open');
    overlayEl.classList.add('ann-open');
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('ann-open');
    if (overlayEl) overlayEl.classList.remove('ann-open');
  }

  function togglePanel() {
    if (panelEl && panelEl.classList.contains('ann-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ── Filter ──

  function getByLabel(labelId) {
    return getAllAnnotations().filter(a => a.label === labelId);
  }

  function search(query) {
    if (!query || typeof query !== 'string') return [];
    const q = query.toLowerCase();
    return getAllAnnotations().filter(a =>
      a.text.toLowerCase().includes(q)
    );
  }

  // ── Init ──

  function init() {
    injectStyles();
    load();
    renderBadges();

    // Re-render badges when messages are added
    const output = document.getElementById('chat-output');
    if (output) {
      const observer = new MutationObserver(() => {
        renderBadges();
      });
      observer.observe(output, { childList: true });
    }
  }

  return {
    init,
    addAnnotation,
    removeAnnotation,
    getAnnotation,
    getAllAnnotations,
    getCount,
    hasAnnotation,
    clearAll,
    getLabels,
    getByLabel,
    search,
    exportAnnotations,
    openPanel,
    closePanel,
    togglePanel,
    renderBadges,
    openEditor,
  };
})();


/* ---------- Conversation Chapters ---------- */
/**
 * Named chapter markers that divide long conversations into navigable
 * sections. Chapters are stored as { messageIndex, title, createdAt }
 * entries keyed by session. A floating table-of-contents panel lets the
 * user jump between chapters; visual dividers are injected into the
 * history panel.
 *
 * Public API:
 *   init()                    - inject styles, load state, render
 *   addChapter(idx, title)    - insert a chapter marker before messageIndex
 *   removeChapter(idx)        - remove the chapter at messageIndex
 *   renameChapter(idx, title) - rename an existing chapter
 *   getChapters()             - sorted array of chapter objects
 *   getChapterAt(idx)         - chapter at exact messageIndex or null
 *   getChapterFor(idx)        - chapter whose range contains messageIndex
 *   clearAll()                - remove all chapters
 *   openPanel() / closePanel() / togglePanel()
 *   exportChapters()          - JSON string
 *   importChapters(json)      - merge from JSON
 *   renderDividers()          - inject divider elements into history panel
 *   getCount()                - number of chapters
 */
const ConversationChapters = (() => {
  'use strict';

  const STORAGE_KEY = 'agenticchat_chapters';
  const MAX_CHAPTERS = 100;
  const MAX_TITLE_LENGTH = 80;

  // chapters: { [messageIndex: number]: { title, createdAt } }
  let chapters = {};
  let panelEl = null;
  let overlayEl = null;
  let styleInjected = false;

  // -- Persistence --

  function save() {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(chapters)); } catch (_) {}
  }

  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) {
        const parsed = sanitizeStorageObject(JSON.parse(raw));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          chapters = parsed;
        }
      }
    } catch (_) { chapters = {}; }
  }

  // -- Styles --

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '#chapters-panel {',
      '  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);',
      '  width: 420px; max-width: 90vw; max-height: 70vh; z-index: 1100;',
      '  background: var(--ch-bg, #0d1117); border: 1px solid var(--ch-border, #30363d);',
      '  border-radius: 10px; display: none; flex-direction: column; overflow: hidden;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '}',
      '#chapters-panel.ch-open { display: flex; }',
      '#chapters-header {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  padding: 12px 16px; border-bottom: 1px solid var(--ch-border, #30363d);',
      '}',
      '#chapters-header h3 { margin: 0; color: #f0883e; font-size: 15px; }',
      '#chapters-header-actions { display: flex; gap: 6px; }',
      '#chapters-header-actions button {',
      '  background: #21262d; border: 1px solid #30363d; color: #c9d1d9;',
      '  padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;',
      '}',
      '#chapters-header-actions button:hover { background: #30363d; }',
      '#chapters-body {',
      '  flex: 1; overflow-y: auto; padding: 8px 12px;',
      '}',
      '#chapters-body:empty::after {',
      '  content: "No chapters yet. Add one from the history panel or press Alt+C.";',
      '  display: block; color: #6e7681; font-size: 13px; text-align: center;',
      '  padding: 24px 12px;',
      '}',
      '.ch-item {',
      '  display: flex; gap: 8px; padding: 8px 10px; border-radius: 6px;',
      '  margin-bottom: 4px; background: var(--ch-item-bg, #161b22); cursor: pointer;',
      '  align-items: center; transition: background 0.12s;',
      '}',
      '.ch-item:hover { background: var(--ch-item-hover, #1c2333); }',
      '.ch-item-num {',
      '  font-size: 11px; font-weight: 700; color: #f0883e;',
      '  min-width: 22px; text-align: center;',
      '}',
      '.ch-item-title {',
      '  flex: 1; font-size: 13px; color: #c9d1d9; white-space: nowrap;',
      '  overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.ch-item-meta {',
      '  font-size: 10px; color: #6e7681; white-space: nowrap;',
      '}',
      '.ch-item-actions { display: flex; gap: 2px; }',
      '.ch-item-actions button {',
      '  background: none; border: none; color: #6e7681; cursor: pointer;',
      '  font-size: 11px; padding: 2px 4px;',
      '}',
      '.ch-item-actions button:hover { color: #c9d1d9; }',
      '#chapters-overlay {',
      '  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1050;',
      '  display: none;',
      '}',
      '#chapters-overlay.ch-open { display: block; }',
      '.ch-divider {',
      '  display: flex; align-items: center; gap: 10px; margin: 12px 0;',
      '  user-select: none;',
      '}',
      '.ch-divider-line {',
      '  flex: 1; height: 1px; background: #f0883e40;',
      '}',
      '.ch-divider-label {',
      '  font-size: 11px; font-weight: 600; color: #f0883e;',
      '  letter-spacing: 0.04em; text-transform: uppercase;',
      '  padding: 2px 10px; background: #f0883e15; border-radius: 10px;',
      '  white-space: nowrap;',
      '}',
      '.ch-add-btn {',
      '  position: absolute; top: 4px; right: 56px; width: 22px; height: 22px;',
      '  border-radius: 50%; display: flex; align-items: center; justify-content: center;',
      '  font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.15s;',
      '  z-index: 5; background: rgba(240,136,62,0.2); border: 1px solid rgba(240,136,62,0.3);',
      '  color: #f0883e; font-weight: bold;',
      '}',
      '.history-msg { position: relative; }',
      '.history-msg:hover .ch-add-btn { opacity: 0.6; }',
      '.history-msg:hover .ch-add-btn:hover { opacity: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // -- CRUD --

  function addChapter(messageIndex, title) {
    if (typeof messageIndex !== 'number' || messageIndex < 0) return null;
    if (!title || typeof title !== 'string') return null;
    title = title.trim().substring(0, MAX_TITLE_LENGTH);
    if (!title) return null;
    if (Object.keys(chapters).length >= MAX_CHAPTERS && !(messageIndex in chapters)) return null;

    var existing = chapters[messageIndex];
    chapters[messageIndex] = {
      title: title,
      createdAt: existing ? existing.createdAt : Date.now(),
    };
    save();
    return chapters[messageIndex];
  }

  function removeChapter(messageIndex) {
    if (!(messageIndex in chapters)) return false;
    delete chapters[messageIndex];
    save();
    return true;
  }

  function renameChapter(messageIndex, newTitle) {
    if (!(messageIndex in chapters)) return false;
    if (!newTitle || typeof newTitle !== 'string') return false;
    newTitle = newTitle.trim().substring(0, MAX_TITLE_LENGTH);
    if (!newTitle) return false;
    chapters[messageIndex].title = newTitle;
    save();
    return true;
  }

  function getChapters() {
    return Object.keys(chapters)
      .map(Number)
      .sort(function(a, b) { return a - b; })
      .map(function(idx, i) {
        return {
          messageIndex: idx,
          number: i + 1,
          title: chapters[idx].title,
          createdAt: chapters[idx].createdAt,
        };
      });
  }

  function getChapterAt(messageIndex) {
    var ch = chapters[messageIndex];
    if (!ch) return null;
    var sorted = getChapters();
    var found = null;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].messageIndex === messageIndex) { found = sorted[i]; break; }
    }
    return found;
  }

  function getChapterFor(messageIndex) {
    var sorted = getChapters();
    var result = null;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].messageIndex <= messageIndex) {
        result = sorted[i];
      } else {
        break;
      }
    }
    return result;
  }

  function getCount() {
    return Object.keys(chapters).length;
  }

  function clearAll() {
    chapters = {};
    save();
  }

  // -- Export/Import --

  function exportChapters() {
    return JSON.stringify(getChapters(), null, 2);
  }

  function importChapters(json) {
    try {
      var arr = typeof json === 'string' ? JSON.parse(json) : json;
      if (!Array.isArray(arr)) return 0;
      var imported = 0;
      for (var j = 0; j < arr.length; j++) {
        var item = arr[j];
        if (typeof item.messageIndex === 'number' && typeof item.title === 'string') {
          if (Object.keys(chapters).length < MAX_CHAPTERS || (item.messageIndex in chapters)) {
            chapters[item.messageIndex] = {
              title: item.title.substring(0, MAX_TITLE_LENGTH),
              createdAt: item.createdAt || Date.now(),
            };
            imported++;
          }
        }
      }
      if (imported > 0) save();
      return imported;
    } catch (_) { return 0; }
  }

  // -- Panel UI --

  function buildPanel() {
    if (panelEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'chapters-overlay';
    overlayEl.addEventListener('click', closePanel);
    document.body.appendChild(overlayEl);

    panelEl = document.createElement('div');
    panelEl.id = 'chapters-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Conversation Chapters');

    // Header
    var header = document.createElement('div');
    header.id = 'chapters-header';
    var h3 = document.createElement('h3');
    h3.textContent = '\uD83D\uDCD1 Chapters';
    header.appendChild(h3);

    var actions = document.createElement('div');
    actions.id = 'chapters-header-actions';

    var exportBtn = document.createElement('button');
    exportBtn.textContent = '\uD83D\uDCCB Export';
    exportBtn.title = 'Copy chapters as JSON';
    exportBtn.addEventListener('click', function() {
      try {
        navigator.clipboard.writeText(exportChapters());
        exportBtn.textContent = '\u2713 Copied';
        setTimeout(function() { exportBtn.textContent = '\uD83D\uDCCB Export'; }, 1500);
      } catch (_) { /* ignore */ }
    });
    actions.appendChild(exportBtn);

    var clearBtn = document.createElement('button');
    clearBtn.textContent = '\uD83D\uDDD1\uFE0F Clear';
    clearBtn.title = 'Remove all chapters';
    clearBtn.addEventListener('click', function() {
      if (Object.keys(chapters).length === 0) return;
      clearAll();
      renderPanel();
    });
    actions.appendChild(clearBtn);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', closePanel);
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    panelEl.appendChild(header);

    // Body
    var body = document.createElement('div');
    body.id = 'chapters-body';
    panelEl.appendChild(body);

    document.body.appendChild(panelEl);
  }

  function renderPanel() {
    var body = document.getElementById('chapters-body');
    if (!body) return;
    body.innerHTML = '';

    var sorted = getChapters();
    if (sorted.length === 0) return;

    var history = ConversationManager.getHistory();

    for (var c = 0; c < sorted.length; c++) {
      var ch = sorted[c];
      var item = document.createElement('div');
      item.className = 'ch-item';
      item.title = 'Click to scroll to this chapter';

      var num = document.createElement('span');
      num.className = 'ch-item-num';
      num.textContent = String(ch.number);
      item.appendChild(num);

      var titleEl = document.createElement('span');
      titleEl.className = 'ch-item-title';
      titleEl.textContent = ch.title;
      item.appendChild(titleEl);

      // Message count in this chapter
      var nextCh = sorted[c + 1];
      var endIdx = nextCh ? nextCh.messageIndex : history.length;
      var msgCount = endIdx - ch.messageIndex;
      var meta = document.createElement('span');
      meta.className = 'ch-item-meta';
      meta.textContent = msgCount + ' msg' + (msgCount !== 1 ? 's' : '');
      item.appendChild(meta);

      var actionsDiv = document.createElement('span');
      actionsDiv.className = 'ch-item-actions';

      (function(chRef) {
        var renameBtn = document.createElement('button');
        renameBtn.textContent = '\u270F\uFE0F';
        renameBtn.title = 'Rename chapter';
        renameBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var newTitle = window.prompt('Rename chapter:', chRef.title);
          if (newTitle) {
            renameChapter(chRef.messageIndex, newTitle);
            renderPanel();
          }
        });
        actionsDiv.appendChild(renameBtn);

        var delBtn = document.createElement('button');
        delBtn.textContent = '\uD83D\uDDD1\uFE0F';
        delBtn.title = 'Remove chapter';
        delBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          removeChapter(chRef.messageIndex);
          renderPanel();
          renderDividers();
        });
        actionsDiv.appendChild(delBtn);

        item.addEventListener('click', function() {
          scrollToMessageIndex(chRef.messageIndex);
          closePanel();
        });
      })(ch);

      item.appendChild(actionsDiv);
      body.appendChild(item);
    }
  }

  function scrollToMessageIndex(targetIndex) {
    // Try history panel messages first
    var historyPanel = document.getElementById('history-messages');
    if (historyPanel) {
      var msgs = historyPanel.querySelectorAll('.history-msg');
      var history = ConversationManager.getHistory();
      var domIndex = 0;
      for (var i = 0; i < history.length; i++) {
        if (history[i].role === 'system') continue;
        if (i === targetIndex) break;
        domIndex++;
      }
      var target = msgs[domIndex];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.style.outline = '2px solid #f0883e';
        setTimeout(function() { target.style.outline = ''; }, 2000);
        return;
      }
    }

    // Fallback: try ConversationTimeline
    if (typeof ConversationTimeline !== 'undefined' && ConversationTimeline.scrollToMessage) {
      ConversationTimeline.scrollToMessage(targetIndex);
    }
  }

  function openPanel() {
    buildPanel();
    renderPanel();
    panelEl.classList.add('ch-open');
    overlayEl.classList.add('ch-open');
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('ch-open');
    if (overlayEl) overlayEl.classList.remove('ch-open');
  }

  function togglePanel() {
    if (panelEl && panelEl.classList.contains('ch-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // -- History Panel Dividers --

  function renderDividers() {
    var historyPanel = document.getElementById('history-messages');
    if (!historyPanel) return;

    // Remove existing dividers
    var existing = historyPanel.querySelectorAll('.ch-divider');
    for (var i = 0; i < existing.length; i++) {
      existing[i].remove();
    }

    var sorted = getChapters();
    if (sorted.length === 0) return;

    var msgs = historyPanel.querySelectorAll('.history-msg');
    var history = ConversationManager.getHistory();

    // Build index map: history index -> DOM index (skipping system messages)
    var indexMap = {};
    var domIdx = 0;
    for (var k = 0; k < history.length; k++) {
      if (history[k].role === 'system') continue;
      indexMap[k] = domIdx;
      domIdx++;
    }

    for (var s = 0; s < sorted.length; s++) {
      var ch = sorted[s];
      var di = indexMap[ch.messageIndex];
      if (di === undefined) continue;
      var msgEl = msgs[di];
      if (!msgEl) continue;

      var divider = document.createElement('div');
      divider.className = 'ch-divider';
      divider.setAttribute('data-chapter-index', ch.messageIndex);

      var line1 = document.createElement('span');
      line1.className = 'ch-divider-line';
      divider.appendChild(line1);

      var label = document.createElement('span');
      label.className = 'ch-divider-label';
      label.textContent = '\u00A7' + ch.number + ' ' + ch.title;
      divider.appendChild(label);

      var line2 = document.createElement('span');
      line2.className = 'ch-divider-line';
      divider.appendChild(line2);

      msgEl.parentNode.insertBefore(divider, msgEl);
    }
  }

  // -- Add-chapter buttons on history messages --

  function renderAddButtons() {
    var historyPanel = document.getElementById('history-messages');
    if (!historyPanel) return;

    // Remove old buttons
    var old = historyPanel.querySelectorAll('.ch-add-btn');
    for (var i = 0; i < old.length; i++) old[i].remove();

    var msgs = historyPanel.querySelectorAll('.history-msg');
    var history = ConversationManager.getHistory();

    // Build reverse map: DOM index -> history index
    var reverseMap = [];
    for (var r = 0; r < history.length; r++) {
      if (history[r].role !== 'system') reverseMap.push(r);
    }

    for (var d = 0; d < msgs.length; d++) {
      var histIdx = reverseMap[d];
      if (histIdx === undefined) continue;
      if (histIdx in chapters) continue;

      (function(idx) {
        var btn = document.createElement('button');
        btn.className = 'ch-add-btn';
        btn.textContent = '\u00A7';
        btn.title = 'Add chapter marker here';
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var suggested = suggestTitle(idx);
          var title = window.prompt('Chapter title:', suggested);
          if (title) {
            addChapter(idx, title);
            renderDividers();
            renderAddButtons();
          }
        });
        msgs[d].appendChild(btn);
      })(histIdx);
    }
  }

  // -- Quick-add: latest message --

  /**
   * Suggest a context-aware chapter title based on messages starting at the given index.
   * Analyzes the message for code blocks, questions, and topic keywords.
   *
   * @param {number} messageIndex  Index into ConversationManager.getHistory()
   * @returns {string} Suggested title
   */
  function suggestTitle(messageIndex) {
    var history = ConversationManager.getHistory();
    var idx = typeof messageIndex === 'number' ? messageIndex : history.length - 1;
    if (idx < 0 || idx >= history.length) return 'Chapter ' + (getCount() + 1);

    // Gather up to 5 messages from the start index (skip system messages)
    var msgs = [];
    for (var i = idx; i < history.length && msgs.length < 5; i++) {
      if (history[i].role !== 'system') msgs.push(history[i]);
    }
    if (msgs.length === 0) return 'Chapter ' + (getCount() + 1);

    var firstMsg = msgs[0];
    var content = (firstMsg.content || '').trim();

    // 1. Code block detection
    var codeFenceMatch = content.match(/```(\w*)/);
    if (codeFenceMatch) {
      var lang = codeFenceMatch[1];
      var textBefore = content.split('```')[0].trim();
      if (lang && textBefore.length > 5 && textBefore.length < 60) {
        return 'Code: ' + _capitalize(textBefore);
      }
      if (lang) return 'Code: ' + lang.charAt(0).toUpperCase() + lang.slice(1);
      return 'Code Discussion';
    }

    // 2. Question detection
    if (content.indexOf('?') !== -1) {
      var questionLine = '';
      var lines = content.split('\n');
      for (var q = 0; q < lines.length; q++) {
        if (lines[q].indexOf('?') !== -1) {
          questionLine = lines[q].trim();
          break;
        }
      }
      if (questionLine.length > 0) {
        questionLine = questionLine.replace(/[#*_`~\[\]]/g, '').trim();
        if (questionLine.length > MAX_TITLE_LENGTH) {
          questionLine = questionLine.substring(0, MAX_TITLE_LENGTH - 3) + '...';
        }
        return questionLine;
      }
    }

    // 3. Topic extraction via keyword matching
    var topicKeywords = {
      'bug': 'Bug Fix', 'error': 'Error Resolution', 'fix': 'Bug Fix',
      'setup': 'Setup Discussion', 'install': 'Installation',
      'config': 'Configuration', 'deploy': 'Deployment',
      'test': 'Testing', 'refactor': 'Refactoring',
      'design': 'Design Discussion', 'review': 'Code Review',
      'performance': 'Performance', 'optimize': 'Optimization',
      'security': 'Security', 'auth': 'Authentication',
      'api': 'API Discussion', 'database': 'Database',
      'ui': 'UI Discussion', 'style': 'Styling',
      'debug': 'Debugging', 'help': 'Help Request',
      'explain': 'Explanation', 'implement': 'Implementation',
      'feature': 'Feature Discussion', 'update': 'Update',
      'migration': 'Migration', 'documentation': 'Documentation',
    };

    var lowerContent = content.toLowerCase();
    var matchedTopics = [];
    var keywords = Object.keys(topicKeywords);
    for (var k = 0; k < keywords.length; k++) {
      var re = new RegExp('\\b' + keywords[k] + '\\b', 'i');
      if (re.test(lowerContent)) {
        matchedTopics.push(topicKeywords[keywords[k]]);
        if (matchedTopics.length >= 2) break;
      }
    }
    if (matchedTopics.length > 0) {
      var seen = {};
      var unique = [];
      for (var u = 0; u < matchedTopics.length; u++) {
        if (!seen[matchedTopics[u]]) { seen[matchedTopics[u]] = true; unique.push(matchedTopics[u]); }
      }
      return unique.join(' & ');
    }

    // 4. Fallback: use first line
    var firstLine = content.split('\n')[0].replace(/[#*_`~\[\]]/g, '').trim();
    if (firstLine.length > 5 && firstLine.length <= MAX_TITLE_LENGTH) {
      return _capitalize(firstLine);
    }
    if (firstLine.length > MAX_TITLE_LENGTH) {
      return _capitalize(firstLine.substring(0, MAX_TITLE_LENGTH - 3)) + '...';
    }

    return 'Chapter ' + (getCount() + 1);
  }

  function _capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function addChapterAtCurrent(title) {
    var history = ConversationManager.getHistory();
    var lastNonSystem = history.length - 1;
    if (lastNonSystem < 1) return null;
    return addChapter(lastNonSystem, title || suggestTitle(lastNonSystem));
  }

  // Eagerly load persisted state so chapters are available before init()
  load();

  // -- Init --

  function init() {
    injectStyles();

    // Watch for history panel open to inject dividers + add-buttons
    var historyPanel = document.getElementById('history-panel');
    if (historyPanel) {
      var observer = new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
          if (mutations[m].type === 'attributes' && mutations[m].attributeName === 'class') {
            if (historyPanel.classList.contains('open')) {
              setTimeout(function() {
                renderDividers();
                renderAddButtons();
              }, 50);
            }
          }
        }
      });
      observer.observe(historyPanel, { attributes: true, attributeFilter: ['class'] });
    }

    // Keyboard shortcut: Alt+C to add chapter at current position
    document.addEventListener('keydown', function(e) {
      if (e.altKey && e.key === 'c' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        var suggested = suggestTitle(ConversationManager.getHistory().length - 1);
        var title = window.prompt('Chapter title:', suggested);
        if (title) {
          addChapterAtCurrent(title);
        }
      }
      // Alt+Shift+C to open chapters panel
      if (e.altKey && e.shiftKey && e.key === 'C' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  return {
    init: init,
    addChapter: addChapter,
    removeChapter: removeChapter,
    renameChapter: renameChapter,
    getChapters: getChapters,
    getChapterAt: getChapterAt,
    getChapterFor: getChapterFor,
    getCount: getCount,
    clearAll: clearAll,
    openPanel: openPanel,
    closePanel: closePanel,
    togglePanel: togglePanel,
    exportChapters: exportChapters,
    importChapters: importChapters,
    renderDividers: renderDividers,
    renderAddButtons: renderAddButtons,
    addChapterAtCurrent: addChapterAtCurrent,
    suggestTitle: suggestTitle,
    scrollToMessageIndex: scrollToMessageIndex,
  };
})();

/* ---------- Conversation Tags ---------- */
/**
 * ConversationTags — colored label tags for organizing conversations.
 *
 * Lets users attach colored tags (e.g. "work", "research", "code review")
 * to any conversation session. Tags are stored alongside sessions in
 * localStorage and rendered as colored pills on session cards.
 *
 * Features:
 *   - Add/remove tags per session (up to 5 per session)
 *   - 12 predefined colors, auto-assigned based on tag name hash
 *   - Filter session list by tag
 *   - Manage tags: view all tags with usage counts
 *   - Bulk tag operations (rename, delete across all sessions)
 *   - Persistent via localStorage
 *   - Integrates with SessionManager card rendering
 *
 * Usage:
 *   ConversationTags.addTag(sessionId, 'research')
 *   ConversationTags.removeTag(sessionId, 'research')
 *   ConversationTags.getTagsForSession(sessionId)
 *   ConversationTags.getActiveFilter()      // current filter tag or null
 *   ConversationTags.setFilter('research')  // filter session list
 *   ConversationTags.clearFilter()
 *
 * @namespace ConversationTags
 */
const ConversationTags = (() => {
  const STORAGE_KEY = 'agenticchat_session_tags';
  const MAX_TAGS_PER_SESSION = 5;
  const MAX_TAG_LENGTH = 30;

  // 12 distinct colors for tag pills
  const TAG_COLORS = [
    '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
    '#1abc9c', '#3498db', '#9b59b6', '#e84393',
    '#00b894', '#6c5ce7', '#fd79a8', '#636e72'
  ];

  /** Tag data: { [sessionId]: ['tag1', 'tag2', ...] } */
  let tagMap = {};
  let activeFilter = null;
  let filterBar = null;

  // ── Persistence ─────────────────────────────────────────────

  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      tagMap = raw ? sanitizeStorageObject(JSON.parse(raw)) : {};
    } catch { tagMap = {}; }
  }

  function save() {
    try {
      SafeStorage.set(STORAGE_KEY, JSON.stringify(tagMap));
    } catch { /* quota exceeded — tags are non-critical */ }
  }

  // ── Color assignment ────────────────────────────────────────

  /** Deterministic color from tag name (hash-based). */
  function colorForTag(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  }

  // ── Tag CRUD ────────────────────────────────────────────────

  /** Sanitize a tag name: lowercase, trim, truncate. */
  function sanitize(tag) {
    return tag.trim().toLowerCase().substring(0, MAX_TAG_LENGTH);
  }

  /** Get tags for a session. */
  function getTagsForSession(sessionId) {
    return (tagMap[sessionId] || []).slice();
  }

  /** Add a tag to a session. Returns false if invalid, duplicate, or at limit. */
  function addTag(sessionId, tag) {
    const clean = sanitize(tag);
    if (!clean || !sessionId) return false;
    if (!tagMap[sessionId]) tagMap[sessionId] = [];
    if (tagMap[sessionId].length >= MAX_TAGS_PER_SESSION) return false;
    if (tagMap[sessionId].includes(clean)) return false;
    tagMap[sessionId].push(clean);
    save();
    return true;
  }

  /** Remove a tag from a session. Returns false if not found. */
  function removeTag(sessionId, tag) {
    const clean = sanitize(tag);
    const tags = tagMap[sessionId];
    if (!tags) return false;
    const idx = tags.indexOf(clean);
    if (idx === -1) return false;
    tags.splice(idx, 1);
    if (tags.length === 0) delete tagMap[sessionId];
    save();
    return true;
  }

  /** Remove all tags for a session (called on session delete). */
  function clearSession(sessionId) {
    if (tagMap[sessionId]) {
      delete tagMap[sessionId];
      save();
    }
  }

  /** Get all unique tags across all sessions, sorted by usage count desc. */
  function getAllTags() {
    const counts = {};
    for (const tags of Object.values(tagMap)) {
      for (const t of tags) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count, color: colorForTag(tag) }));
  }

  /** Rename a tag across all sessions. */
  function renameTag(oldTag, newTag) {
    const oldClean = sanitize(oldTag);
    const newClean = sanitize(newTag);
    if (!oldClean || !newClean || oldClean === newClean) return false;
    let changed = false;
    for (const [sid, tags] of Object.entries(tagMap)) {
      const idx = tags.indexOf(oldClean);
      if (idx !== -1) {
        // Avoid duplicates after rename
        if (tags.includes(newClean)) {
          tags.splice(idx, 1);
        } else {
          tags[idx] = newClean;
        }
        if (tags.length === 0) delete tagMap[sid];
        changed = true;
      }
    }
    if (changed) save();
    if (activeFilter === oldClean) activeFilter = newClean;
    return changed;
  }

  /** Delete a tag across all sessions. */
  function deleteTag(tag) {
    const clean = sanitize(tag);
    let changed = false;
    for (const [sid, tags] of Object.entries(tagMap)) {
      const idx = tags.indexOf(clean);
      if (idx !== -1) {
        tags.splice(idx, 1);
        if (tags.length === 0) delete tagMap[sid];
        changed = true;
      }
    }
    if (changed) save();
    if (activeFilter === clean) activeFilter = null;
    return changed;
  }

  // ── Filtering ───────────────────────────────────────────────

  /** Get the current filter tag (or null). */
  function getActiveFilter() { return activeFilter; }

  /** Set filter to show only sessions with this tag. */
  function setFilter(tag) {
    activeFilter = sanitize(tag) || null;
    renderFilterBar();
  }

  /** Clear the filter. */
  function clearFilter() {
    activeFilter = null;
    renderFilterBar();
  }

  /** Check if a session matches the current filter. */
  function matchesFilter(sessionId) {
    if (!activeFilter) return true;
    const tags = tagMap[sessionId] || [];
    return tags.includes(activeFilter);
  }

  /** Get session IDs that have a specific tag. */
  function getSessionsWithTag(tag) {
    const clean = sanitize(tag);
    const result = [];
    for (const [sid, tags] of Object.entries(tagMap)) {
      if (tags.includes(clean)) result.push(sid);
    }
    return result;
  }

  // ── UI: Tag pills on session cards ──────────────────────────

  /** Create tag pill elements for a session card. */
  function renderTagPills(sessionId) {
    const container = document.createElement('div');
    container.className = 'session-tags';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;';

    const tags = getTagsForSession(sessionId);
    tags.forEach(tag => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = tag;
      pill.title = `Click to filter by "${tag}". Right-click to remove.`;
      pill.style.cssText =
        'display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;' +
        'cursor:pointer;color:#fff;font-weight:500;line-height:1.6;' +
        'background:' + colorForTag(tag) + ';';

      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        setFilter(tag);
        // Trigger session panel refresh if SessionManager exposes it
        if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
          SessionManager.refresh();
        }
      });

      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeTag(sessionId, tag);
        if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
          SessionManager.refresh();
        }
      });

      container.appendChild(pill);
    });

    // Add tag button (if under limit)
    if (tags.length < MAX_TAGS_PER_SESSION) {
      const addBtn = document.createElement('button');
      addBtn.className = 'tag-add-btn';
      addBtn.textContent = '+ tag';
      addBtn.title = 'Add a tag to this conversation';
      addBtn.style.cssText =
        'display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;' +
        'cursor:pointer;border:1px dashed #888;background:transparent;color:#888;' +
        'line-height:1.6;';

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showTagInput(sessionId, container, addBtn);
      });

      container.appendChild(addBtn);
    }

    return container;
  }

  /** Show inline tag input on the session card. */
  function showTagInput(sessionId, container, addBtn) {
    // Replace the add button with an input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'tag name…';
    input.maxLength = MAX_TAG_LENGTH;
    input.style.cssText =
      'width:80px;padding:1px 6px;border-radius:10px;font-size:11px;' +
      'border:1px solid #6c5ce7;outline:none;background:transparent;' +
      'color:inherit;line-height:1.6;';

    function commit() {
      const val = input.value.trim();
      if (val) {
        addTag(sessionId, val);
      }
      if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
        SessionManager.refresh();
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = ''; input.blur(); }
      e.stopPropagation(); // prevent keyboard shortcuts
    });

    addBtn.replaceWith(input);
    input.focus();
  }

  // ── UI: Filter bar ──────────────────────────────────────────

  /** Render the active filter indicator in the sessions panel. */
  function renderFilterBar() {
    // Remove existing
    if (filterBar && filterBar.parentNode) {
      filterBar.parentNode.removeChild(filterBar);
    }

    if (!activeFilter) {
      filterBar = null;
      return;
    }

    filterBar = document.createElement('div');
    filterBar.className = 'tag-filter-bar';
    filterBar.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 12px;' +
      'margin:4px 8px 8px;border-radius:8px;font-size:13px;' +
      'background:rgba(108,92,231,0.15);';

    const label = document.createElement('span');
    label.textContent = 'Filtered by: ';
    label.style.color = '#888';
    filterBar.appendChild(label);

    const pill = document.createElement('span');
    pill.textContent = activeFilter;
    pill.style.cssText =
      'display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;' +
      'color:#fff;font-weight:500;background:' + colorForTag(activeFilter) + ';';
    filterBar.appendChild(pill);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ Clear';
    clearBtn.style.cssText =
      'margin-left:auto;background:none;border:none;cursor:pointer;' +
      'color:#888;font-size:12px;';
    clearBtn.addEventListener('click', () => {
      clearFilter();
      if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
        SessionManager.refresh();
      }
    });
    filterBar.appendChild(clearBtn);

    // Insert into sessions panel
    const panel = document.getElementById('sessions-panel');
    if (panel) {
      const container = panel.querySelector('.sessions-list') ||
                        panel.querySelector('[class*="session"]');
      if (container) {
        container.parentNode.insertBefore(filterBar, container);
      } else {
        panel.appendChild(filterBar);
      }
    }
  }

  // ── UI: Tag management modal ────────────────────────────────

  /** Open a modal showing all tags with counts and management options. */
  function openManager() {
    // Remove existing
    const existing = document.getElementById('tag-manager-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tag-manager-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.5);z-index:10000;display:flex;' +
      'align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText =
      'background:var(--bg, #1a1a2e);color:var(--fg, #e0e0e0);' +
      'border-radius:12px;padding:24px;max-width:400px;width:90%;' +
      'max-height:70vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

    const title = document.createElement('h3');
    title.textContent = '🏷️ Manage Tags';
    title.style.cssText = 'margin:0 0 16px;font-size:18px;';
    modal.appendChild(title);

    const allTags = getAllTags();

    if (allTags.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No tags yet. Add tags to conversations in the Sessions panel.';
      empty.style.color = '#888';
      modal.appendChild(empty);
    } else {
      allTags.forEach(({ tag, count, color }) => {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;padding:8px 0;' +
          'border-bottom:1px solid rgba(255,255,255,0.1);';

        const pill = document.createElement('span');
        pill.textContent = tag;
        pill.style.cssText =
          'display:inline-block;padding:2px 10px;border-radius:10px;' +
          'font-size:12px;color:#fff;font-weight:500;background:' + color + ';';
        row.appendChild(pill);

        const countEl = document.createElement('span');
        countEl.textContent = count + ' session' + (count !== 1 ? 's' : '');
        countEl.style.cssText = 'flex:1;font-size:12px;color:#888;';
        row.appendChild(countEl);

        const filterBtn = document.createElement('button');
        filterBtn.textContent = '🔍';
        filterBtn.title = 'Filter by this tag';
        filterBtn.style.cssText =
          'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;';
        filterBtn.addEventListener('click', () => {
          setFilter(tag);
          overlay.remove();
          if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
            SessionManager.refresh();
          }
        });
        row.appendChild(filterBtn);

        const renameBtn = document.createElement('button');
        renameBtn.textContent = '✏️';
        renameBtn.title = 'Rename tag';
        renameBtn.style.cssText =
          'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;';
        renameBtn.addEventListener('click', () => {
          const newName = prompt('Rename tag "' + tag + '" to:', tag);
          if (newName && newName.trim() && newName.trim() !== tag) {
            renameTag(tag, newName.trim());
            overlay.remove();
            openManager(); // re-open with updated data
          }
        });
        row.appendChild(renameBtn);

        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = 'Delete tag from all sessions';
        delBtn.style.cssText =
          'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;';
        delBtn.addEventListener('click', () => {
          if (confirm('Remove tag "' + tag + '" from all ' + count + ' session(s)?')) {
            deleteTag(tag);
            overlay.remove();
            openManager();
          }
        });
        row.appendChild(delBtn);

        modal.appendChild(row);
      });
    }

    // Auto-tag all button (if AutoTagger available)
    if (typeof AutoTagger !== 'undefined') {
      const autoAllBtn = document.createElement('button');
      autoAllBtn.textContent = '🏷️ Auto-Tag Untagged Sessions';
      autoAllBtn.style.cssText =
        'display:block;margin:16px auto 8px;padding:8px 24px;border-radius:8px;' +
        'border:none;background:#3498db;color:#fff;cursor:pointer;font-size:13px;' +
        'font-weight:500;';
      autoAllBtn.addEventListener('click', () => {
        const result = AutoTagger.applyToAll();
        if (result.tagged > 0) {
          autoAllBtn.textContent = '✓ Tagged ' + result.tagged + ' session' +
            (result.tagged !== 1 ? 's' : '') + ' (' + result.totalApplied + ' tags)';
          autoAllBtn.disabled = true;
          autoAllBtn.style.background = '#2ecc71';
          if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
            SessionManager.refresh();
          }
        } else {
          autoAllBtn.textContent = 'No untagged sessions with detectable topics';
          autoAllBtn.disabled = true;
          autoAllBtn.style.background = '#555';
        }
      });
      modal.appendChild(autoAllBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText =
      'display:block;margin:16px auto 0;padding:8px 24px;border-radius:8px;' +
      'border:1px solid #555;background:transparent;color:inherit;' +
      'cursor:pointer;font-size:14px;';
    closeBtn.addEventListener('click', () => overlay.remove());
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    // Escape to close
    const onKey = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  // ── Init ────────────────────────────────────────────────────

  function init() {
    load();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    addTag: addTag,
    removeTag: removeTag,
    getTagsForSession: getTagsForSession,
    clearSession: clearSession,
    getAllTags: getAllTags,
    renameTag: renameTag,
    deleteTag: deleteTag,
    getActiveFilter: getActiveFilter,
    setFilter: setFilter,
    clearFilter: clearFilter,
    matchesFilter: matchesFilter,
    getSessionsWithTag: getSessionsWithTag,
    renderTagPills: renderTagPills,
    openManager: openManager,
    colorForTag: colorForTag,
    MAX_TAGS_PER_SESSION: MAX_TAGS_PER_SESSION,
  };
})();

// ── Global Session Search ─────────────────────────────────────────
/**
 * @namespace GlobalSessionSearch
 *
 * Full-text search across all saved sessions. Opens a modal panel
 * (Ctrl+Shift+S) where the user can search every message in every
 * saved session. Results are grouped by session with highlighted
 * matches. Clicking a result loads that session.
 */
const GlobalSessionSearch = (() => {
  let isOpen = false;
  let debounceTimer = null;
  const DEBOUNCE_MS = 250;
  const MAX_RESULTS_PER_SESSION = 5;
  const MAX_CONTEXT_CHARS = 160;

  function open() {
    const panel = document.getElementById('global-search-panel');
    const overlay = document.getElementById('global-search-overlay');
    const input = document.getElementById('global-search-input');
    if (!panel) return;
    isOpen = true;
    panel.style.display = 'flex';
    if (overlay) overlay.classList.add('visible');
    if (input) { input.value = ''; input.focus(); }
    _clearResults();
    _setStatus('Type to search across all saved sessions');
  }

  function close() {
    const panel = document.getElementById('global-search-panel');
    const overlay = document.getElementById('global-search-overlay');
    if (!panel) return;
    isOpen = false;
    panel.style.display = 'none';
    if (overlay) overlay.classList.remove('visible');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  function _setStatus(text) {
    const el = document.getElementById('global-search-status');
    if (el) el.textContent = text;
  }

  function _clearResults() {
    const el = document.getElementById('global-search-results');
    if (el) el.innerHTML = '';
  }

  const _esc = _escapeHtml;


  /** Highlight matches in text, returning safe HTML. */
  function _highlight(text, query, caseSensitive) {
    if (!query) return _esc(text);
    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, flags);
    // Split on matches, escaping each part
    const parts = text.split(re);
    return parts.map((part, i) => {
      if (i % 2 === 1) return `<mark>${_esc(part)}</mark>`;
      return _esc(part);
    }).join('');
  }

  /** Extract a snippet of text around the first match. */
  function _extractContext(content, query, caseSensitive) {
    const idx = caseSensitive
      ? content.indexOf(query)
      : content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return content.substring(0, MAX_CONTEXT_CHARS);
    const start = Math.max(0, idx - 50);
    const end = Math.min(content.length, idx + query.length + MAX_CONTEXT_CHARS - 50);
    let snippet = content.substring(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < content.length) snippet += '…';
    return snippet;
  }

  /** Run the search across all sessions. */
  function _search(query) {
    _clearResults();
    if (!query || query.length < 2) {
      _setStatus(query ? 'Type at least 2 characters' : 'Type to search across all saved sessions');
      return;
    }

    const filterUser = document.getElementById('gs-filter-user')?.checked ?? true;
    const filterAssistant = document.getElementById('gs-filter-assistant')?.checked ?? true;
    const caseSensitive = document.getElementById('gs-filter-case')?.checked ?? false;

    const sessions = SessionManager.getAll();
    if (sessions.length === 0) {
      _setStatus('No saved sessions to search');
      return;
    }

    const results = []; // { session, matches: [{ role, content, index }] }
    let totalMatches = 0;

    const lowerQuery = caseSensitive ? query : query.toLowerCase();

    for (const session of sessions) {
      if (!session.messages || !Array.isArray(session.messages)) continue;
      const matches = [];

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        if (!msg || !msg.content) continue;
        if (msg.role === 'user' && !filterUser) continue;
        if (msg.role === 'assistant' && !filterAssistant) continue;

        const haystack = caseSensitive ? msg.content : msg.content.toLowerCase();
        if (haystack.includes(lowerQuery)) {
          matches.push({ role: msg.role, content: msg.content, index: i });
          totalMatches++;
          if (matches.length >= MAX_RESULTS_PER_SESSION) break;
        }
      }

      if (matches.length > 0) {
        results.push({ session, matches });
      }
    }

    if (totalMatches === 0) {
      _setStatus(`No matches for "${query}"`);
      const container = document.getElementById('global-search-results');
      if (container) {
        const empty = document.createElement('div');
        empty.className = 'gs-no-results';
        empty.textContent = 'No messages matched your search across any session.';
        container.appendChild(empty);
      }
      return;
    }

    _setStatus(`${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${results.length} session${results.length !== 1 ? 's' : ''}`);
    _renderResults(results, query, caseSensitive);
  }

  /** Render grouped search results. */
  function _renderResults(results, query, caseSensitive) {
    const container = document.getElementById('global-search-results');
    if (!container) return;
    const frag = document.createDocumentFragment();

    for (const { session, matches } of results) {
      const group = document.createElement('div');
      group.className = 'gs-result-group';

      const header = document.createElement('div');
      header.className = 'gs-result-session';
      header.innerHTML = `${_esc(session.name)} <span class="gs-msg-count">(${matches.length} match${matches.length !== 1 ? 'es' : ''})</span>`;
      header.title = `Load session "${session.name}"`;
      header.addEventListener('click', () => {
        SessionManager.load(session.id);
        close();
      });
      group.appendChild(header);

      for (const match of matches) {
        const item = document.createElement('div');
        item.className = 'gs-result-item';

        const roleEl = document.createElement('div');
        roleEl.className = `gs-role ${match.role}`;
        roleEl.textContent = match.role;
        item.appendChild(roleEl);

        const snippet = _extractContext(match.content, query, caseSensitive);
        const contentEl = document.createElement('div');
        contentEl.innerHTML = _highlight(snippet, query, caseSensitive);
        item.appendChild(contentEl);

        item.addEventListener('click', () => {
          SessionManager.load(session.id);
          close();
          // Try to scroll to the matched message after a short delay
          setTimeout(() => {
            const msgs = document.querySelectorAll('#chat-output > div');
            if (msgs[match.index]) {
              msgs[match.index].scrollIntoView({ behavior: 'smooth', block: 'center' });
              msgs[match.index].style.outline = '2px solid var(--accent, #89b4fa)';
              setTimeout(() => { msgs[match.index].style.outline = ''; }, 2000);
            }
          }, 200);
        });

        group.appendChild(item);
      }
      frag.appendChild(group);
    }
    container.appendChild(frag);
  }

  /** Initialize event listeners. */
  function init() {
    const input = document.getElementById('global-search-input');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => _search(input.value.trim()), DEBOUNCE_MS);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }

    const closeBtn = document.getElementById('global-search-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    const overlay = document.getElementById('global-search-overlay');
    if (overlay) overlay.addEventListener('click', close);

    const btn = document.getElementById('global-search-btn');
    if (btn) btn.addEventListener('click', toggle);

    // Filter checkboxes trigger re-search
    ['gs-filter-user', 'gs-filter-assistant', 'gs-filter-case'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        const q = document.getElementById('global-search-input')?.value?.trim();
        if (q) _search(q);
      });
    });

    // Keyboard shortcut: Ctrl+Shift+S — handled by central KeyboardShortcuts dispatcher
  }

  document.addEventListener('DOMContentLoaded', init);

  return { open, close, toggle, init };
})();

// ── Formatting Toolbar ────────────────────────────────────────────
/**
 * @namespace FormattingToolbar
 *
 * Adds a row of markdown formatting buttons above the chat input field.
 * Supports wrapping selected text or inserting formatting at the cursor.
 *
 * Buttons: Bold, Italic, Inline Code, Code Block, Link, Heading,
 * Bulleted List, Numbered List, Strikethrough, Quote.
 *
 * Features:
 * - Wraps selected text with formatting markers (toggle: re-applies if
 *   already wrapped to allow easy removal by Ctrl+Z)
 * - Inserts placeholder text when nothing is selected
 * - Keyboard shortcuts: Ctrl+E (inline code), Ctrl+Shift+M (toggle toolbar)
 * - Toolbar visibility toggle via button or Ctrl+Shift+M
 * - Compact single-row design that doesn't crowd the existing toolbar
 * - Respects focus mode (hidden when zen mode is active)
 * - Accessible: proper aria-labels, keyboard navigable
 */
const FormattingToolbar = (() => {
  'use strict';

  const STORAGE_KEY = 'agentic_fmt_toolbar_visible';

  // Format definitions: { label, icon, prefix, suffix, placeholder, block }
  // block=true means the format works on entire lines (lists, headings, quotes)
  const FORMATS = [
    { id: 'bold',       icon: '𝐁',  title: 'Bold',                  prefix: '**', suffix: '**', placeholder: 'bold text' },
    { id: 'italic',     icon: '𝐼',  title: 'Italic',                prefix: '_',  suffix: '_',  placeholder: 'italic text' },
    { id: 'code',       icon: '</>',title: 'Inline Code (Ctrl+E)',  prefix: '`',  suffix: '`',  placeholder: 'code' },
    { id: 'codeblock',  icon: '```',title: 'Code Block',            prefix: '```\n', suffix: '\n```', placeholder: 'code here', block: true },
    { id: 'link',       icon: '🔗', title: 'Link',                  prefix: '[',  suffix: '](url)', placeholder: 'link text' },
    { id: 'heading',    icon: 'H',  title: 'Heading',               prefix: '## ', suffix: '',  placeholder: 'heading', block: true },
    { id: 'bullet',     icon: '•',  title: 'Bullet List',           prefix: '- ',  suffix: '',  placeholder: 'list item', block: true },
    { id: 'numbered',   icon: '1.', title: 'Numbered List',         prefix: '1. ', suffix: '',  placeholder: 'list item', block: true },
    { id: 'strike',     icon: '~~', title: 'Strikethrough',         prefix: '~~', suffix: '~~', placeholder: 'text' },
    { id: 'quote',      icon: '>',  title: 'Block Quote',           prefix: '> ',  suffix: '',  placeholder: 'quote', block: true },
  ];

  let toolbar = null;
  let isVisible = false;
  let input = null;

  /**
   * Apply a format to the chat input field.
   * If text is selected, wraps it. Otherwise inserts placeholder.
   */
  function applyFormat(format) {
    if (!input) return;
    input.focus();

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const value = input.value;
    const selected = value.substring(start, end);

    let insertText;
    let cursorOffset;

    if (selected) {
      // Wrap selected text
      insertText = format.prefix + selected + format.suffix;
      cursorOffset = start + insertText.length;
    } else {
      // Insert with placeholder
      insertText = format.prefix + format.placeholder + format.suffix;
      // Position cursor to select the placeholder
      cursorOffset = start + format.prefix.length + format.placeholder.length;
    }

    // Use execCommand for undo support, fall back to direct value set
    const before = value.substring(0, start);
    const after = value.substring(end);
    input.value = before + insertText + after;

    // Set cursor position
    if (selected) {
      input.setSelectionRange(cursorOffset, cursorOffset);
    } else {
      // Select the placeholder so user can type over it
      const pStart = start + format.prefix.length;
      const pEnd = pStart + format.placeholder.length;
      input.setSelectionRange(pStart, pEnd);
    }

    // Trigger input event for char count and other listeners
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Build the toolbar DOM element.
   */
  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.id = 'formatting-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Text formatting');
    toolbar.style.cssText = 'display:none;padding:4px 8px;gap:2px;align-items:center;'
      + 'border-bottom:1px solid var(--border-color, #333);flex-wrap:nowrap;overflow-x:auto;';

    FORMATS.forEach(function(fmt) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fmt-btn';
      btn.setAttribute('data-format', fmt.id);
      btn.setAttribute('aria-label', fmt.title);
      btn.title = fmt.title;
      btn.textContent = fmt.icon;
      btn.style.cssText = 'background:none;border:1px solid transparent;border-radius:4px;'
        + 'padding:3px 7px;cursor:pointer;font-size:13px;color:inherit;'
        + 'font-family:monospace;min-width:28px;text-align:center;';

      btn.addEventListener('mouseenter', function() {
        btn.style.borderColor = 'var(--accent-color, #6c5ce7)';
        btn.style.background = 'var(--hover-bg, rgba(108,92,231,0.1))';
      });
      btn.addEventListener('mouseleave', function() {
        btn.style.borderColor = 'transparent';
        btn.style.background = 'none';
      });

      btn.addEventListener('click', function(e) {
        e.preventDefault();
        applyFormat(fmt);
      });

      toolbar.appendChild(btn);
    });

    return toolbar;
  }

  /**
   * Show/hide the toolbar.
   */
  function toggle() {
    isVisible = !isVisible;
    if (toolbar) {
      toolbar.style.display = isVisible ? 'flex' : 'none';
    }
    SafeStorage.set(STORAGE_KEY, isVisible ? '1' : '0');
  }

  function show() {
    isVisible = true;
    if (toolbar) toolbar.style.display = 'flex';
    SafeStorage.set(STORAGE_KEY, '1');
  }

  function hide() {
    isVisible = false;
    if (toolbar) toolbar.style.display = 'none';
    SafeStorage.set(STORAGE_KEY, '0');
  }

  /**
   * Handle keyboard shortcuts for formatting.
   */
  function onKeyDown(e) {
    // Only when chat input is focused or toolbar shortcuts
    if (e.target.id !== 'chat-input' && !e.ctrlKey) return;

    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      let fmt = null;
      if (e.key === 'e' || e.key === 'E') fmt = FORMATS.find(f => f.id === 'code');

      if (fmt) {
        e.preventDefault();
        applyFormat(fmt);
      }
    }

    // Ctrl+Shift+M to toggle toolbar
    if (e.ctrlKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      toggle();
    }
  }

  /**
   * Get a format definition by its id.
   */
  function getFormat(id) {
    return FORMATS.find(f => f.id === id) || null;
  }

  /**
   * Initialize the formatting toolbar.
   */
  function init() {
    input = document.getElementById('chat-input');
    if (!input) return;

    // Create and insert toolbar above the input's parent toolbar
    const tb = createToolbar();
    const parentToolbar = input.closest('.toolbar');
    if (parentToolbar) {
      parentToolbar.parentNode.insertBefore(tb, parentToolbar);
    } else {
      input.parentNode.insertBefore(tb, input);
    }

    // Restore visibility from SafeStorage
    const saved = SafeStorage.get(STORAGE_KEY);
    if (saved === '1') {
      isVisible = true;
      toolbar.style.display = 'flex';
    }

    // Register keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    toggle: toggle,
    show: show,
    hide: hide,
    applyFormat: applyFormat,
    getFormat: getFormat,
    isVisible: function() { return isVisible; },
    FORMATS: FORMATS,
  };
})();

/* ============================================================
 * AutoTagger — heuristic topic detection and automatic tag suggestions
 *
 * Analyzes conversation messages to detect dominant topics and suggests
 * relevant tags.  Uses a two-layer approach:
 *   1. Category dictionaries — curated keyword lists for common topics
 *   2. TF-IDF-inspired scoring — surface important terms not in the
 *      stop-word list, weighted by frequency relative to message count
 *
 * Integrates with ConversationTags: suggested tags can be applied in
 * one click.  Accessible from session cards ("🏷️ Auto" button) or
 * from the Tags manager ("Auto-tag all" action).
 *
 * Public API:
 *   AutoTagger.analyze(messages)           → [{ tag, score, source }]
 *   AutoTagger.suggestForSession(sessionId) → [{ tag, score, source }]
 *   AutoTagger.applyToSession(sessionId)    → number (tags applied)
 *   AutoTagger.applyToAll()                 → { tagged, totalApplied }
 *   AutoTagger.showSuggestionModal(sessionId) → void (UI)
 *
 * @namespace AutoTagger
 */
const AutoTagger = (() => {
  const MAX_SUGGESTIONS = 5;
  const MIN_SCORE = 0.15;
  const MIN_MESSAGES = 2;

  /* ── Category dictionaries ─────────────────────────────────
   * Each category maps to an array of indicator words/phrases.
   * Scores are boosted when multiple indicators from the same
   * category appear.
   */
  const CATEGORIES = {
    coding: {
      tag: 'coding',
      words: [
        'function', 'variable', 'const', 'class', 'import', 'export',
        'array', 'object', 'loop', 'iterate', 'algorithm', 'compile',
        'debug', 'error', 'bug', 'fix', 'refactor', 'syntax', 'api',
        'endpoint', 'request', 'response', 'json', 'parse', 'regex',
        'typescript', 'javascript', 'python', 'java', 'rust', 'golang',
        'html', 'css', 'react', 'node', 'npm', 'webpack', 'git',
        'commit', 'branch', 'merge', 'pull request', 'repository',
        'database', 'sql', 'query', 'schema', 'index', 'migration',
        'async', 'await', 'promise', 'callback', 'closure'
      ]
    },
    ai: {
      tag: 'ai/ml',
      words: [
        'machine learning', 'deep learning', 'neural network', 'model',
        'training', 'inference', 'dataset', 'feature', 'classification',
        'regression', 'clustering', 'transformer', 'attention', 'gpt',
        'llm', 'prompt', 'embedding', 'token', 'fine-tune', 'finetune',
        'pytorch', 'tensorflow', 'gradient', 'loss function', 'epoch',
        'batch', 'overfitting', 'underfitting', 'hyperparameter',
        'reinforcement learning', 'generative', 'diffusion', 'bert',
        'chatgpt', 'openai', 'anthropic', 'langchain', 'rag',
        'retrieval augmented', 'vector database', 'agent', 'chain'
      ]
    },
    writing: {
      tag: 'writing',
      words: [
        'write', 'essay', 'article', 'blog', 'story', 'narrative',
        'paragraph', 'sentence', 'grammar', 'tone', 'style',
        'proofread', 'edit', 'rewrite', 'summarize', 'outline',
        'creative writing', 'fiction', 'non-fiction', 'draft',
        'headline', 'title', 'introduction', 'conclusion', 'thesis',
        'argument', 'persuasive', 'descriptive', 'poem', 'poetry',
        'dialogue', 'character', 'plot', 'setting', 'metaphor'
      ]
    },
    math: {
      tag: 'math',
      words: [
        'equation', 'formula', 'calculate', 'calculation', 'algebra',
        'calculus', 'derivative', 'integral', 'matrix', 'vector',
        'probability', 'statistics', 'mean', 'median', 'standard deviation',
        'theorem', 'proof', 'geometry', 'trigonometry', 'polynomial',
        'logarithm', 'exponent', 'factorial', 'permutation', 'combination',
        'linear algebra', 'eigenvalue', 'differential', 'graph theory'
      ]
    },
    data: {
      tag: 'data',
      words: [
        'data analysis', 'visualization', 'chart', 'graph', 'plot',
        'dashboard', 'metrics', 'kpi', 'report', 'csv', 'excel',
        'spreadsheet', 'pivot', 'aggregate', 'filter', 'sort',
        'pandas', 'numpy', 'matplotlib', 'seaborn', 'd3', 'tableau',
        'etl', 'pipeline', 'warehouse', 'lake', 'analytics'
      ]
    },
    devops: {
      tag: 'devops',
      words: [
        'docker', 'container', 'kubernetes', 'k8s', 'deploy', 'deployment',
        'ci/cd', 'pipeline', 'jenkins', 'github actions', 'terraform',
        'ansible', 'aws', 'azure', 'gcp', 'cloud', 'server', 'nginx',
        'load balancer', 'scaling', 'microservice', 'monitoring',
        'logging', 'alerting', 'infrastructure', 'helm', 'pod',
        'yaml', 'dockerfile', 'registry', 'orchestration'
      ]
    },
    design: {
      tag: 'design',
      words: [
        'design', 'ui', 'ux', 'user interface', 'user experience',
        'wireframe', 'mockup', 'prototype', 'figma', 'sketch',
        'layout', 'responsive', 'mobile', 'accessibility', 'a11y',
        'color palette', 'typography', 'font', 'icon', 'animation',
        'component', 'design system', 'material design', 'tailwind'
      ]
    },
    business: {
      tag: 'business',
      words: [
        'strategy', 'marketing', 'revenue', 'profit', 'customer',
        'market', 'competitor', 'product', 'roadmap', 'stakeholder',
        'budget', 'forecast', 'roi', 'conversion', 'funnel',
        'acquisition', 'retention', 'growth', 'pricing', 'subscription',
        'saas', 'b2b', 'b2c', 'startup', 'mvp', 'pitch'
      ]
    },
    security: {
      tag: 'security',
      words: [
        'security', 'vulnerability', 'exploit', 'attack', 'threat',
        'encryption', 'decrypt', 'hash', 'authentication', 'authorization',
        'oauth', 'jwt', 'token', 'firewall', 'penetration', 'pentest',
        'xss', 'csrf', 'injection', 'sanitize', 'malware', 'phishing',
        'certificate', 'ssl', 'tls', 'https', 'cors', 'csp'
      ]
    },
    science: {
      tag: 'science',
      words: [
        'research', 'experiment', 'hypothesis', 'theory', 'observation',
        'biology', 'chemistry', 'physics', 'genetics', 'evolution',
        'molecule', 'atom', 'cell', 'protein', 'dna', 'rna',
        'climate', 'ecosystem', 'quantum', 'relativity', 'particle'
      ]
    }
  };

  /* ── Stop words ──────────────────────────────────────────── */
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
    'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours', 'you', 'your',
    'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
    'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those',
    'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
    'any', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very',
    'just', 'also', 'now', 'then', 'here', 'there', 'if', 'or', 'and',
    'but', 'nor', 'for', 'yet', 'about', 'above', 'after', 'again',
    'against', 'at', 'before', 'below', 'between', 'by', 'down',
    'during', 'from', 'in', 'into', 'of', 'off', 'on', 'out', 'over',
    'through', 'to', 'under', 'until', 'up', 'with', 'as', 'like',
    'want', 'know', 'think', 'make', 'get', 'go', 'see', 'say', 'tell',
    'give', 'take', 'come', 'look', 'use', 'find', 'put', 'try', 'ask',
    'work', 'call', 'keep', 'let', 'begin', 'seem', 'help', 'show',
    'hear', 'play', 'run', 'move', 'live', 'believe', 'happen', 'provide',
    'include', 'turn', 'follow', 'start', 'point', 'read', 'right',
    'thing', 'much', 'well', 'way', 'even', 'new', 'because', 'good',
    'long', 'great', 'still', 'own', 'old', 'big', 'something',
    'please', 'thanks', 'thank', 'sure', 'okay', 'yes', 'yeah', 'hi',
    'hello', 'hey', 'one', 'two', 'three', 'first', 'second', 'last',
    'able', 'using', 'used', 'example', 'really', 'actually', 'basically'
  ]);

  /* ── Pre-compiled phrase patterns (avoids re-creating RegExp per call) ── */
  const PHRASE_PATTERNS = {};
  for (const [catId, cat] of Object.entries(CATEGORIES)) {
    PHRASE_PATTERNS[catId] = [];
    for (const word of cat.words) {
      if (word.includes(' ')) {
        PHRASE_PATTERNS[catId].push({
          word,
          regex: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        });
      }
    }
  }

  /* ── Text processing ─────────────────────────────────────── */

  /**
   * Normalize and tokenize text into lowercase words.
   * Strips markdown code fences and inline code to avoid noise
   * from code examples polluting keyword extraction.
   * @param {string} text
   * @returns {string[]}
   */
  function tokenize(text) {
    // Remove code blocks (``` ... ```)
    let clean = text.replace(/```[\s\S]*?```/g, ' ');
    // Remove inline code (`...`)
    clean = clean.replace(/`[^`]+`/g, ' ');
    // Remove URLs
    clean = clean.replace(/https?:\/\/\S+/g, ' ');
    // Lowercase and split on non-alpha characters
    return clean.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  }

  /**
   * Build a word frequency map from an array of messages.
   * @param {{ role: string, content: string }[]} messages
   * @returns {{ wordFreq: Object, totalWords: number, messageCount: number }}
   */
  function buildFrequencyMap(messages) {
    const wordFreq = Object.create(null);
    let totalWords = 0;
    let messageCount = 0;

    for (const msg of messages) {
      if (msg.role === 'system') continue;
      messageCount++;
      const words = tokenize(msg.content || '');
      for (const w of words) {
        if (STOP_WORDS.has(w)) continue;
        wordFreq[w] = (wordFreq[w] || 0) + 1;
        totalWords++;
      }
    }

    return { wordFreq, totalWords, messageCount };
  }

  /**
   * Score categories against a word frequency map.
   * Multi-word phrases are checked by scanning the original text.
   * @param {{ wordFreq: Object, totalWords: number }} freqData
   * @param {string} combinedText  Lowercased concatenation of all messages
   * @returns {{ tag: string, score: number, source: string, matches: number }[]}
   */
  function scoreCategories(freqData, combinedText) {
    const results = [];

    for (const [catId, cat] of Object.entries(CATEGORIES)) {
      let matches = 0;
      let weightedHits = 0;

      for (const word of cat.words) {
        if (word.includes(' ')) continue; // handled below via pre-compiled patterns
        const count = freqData.wordFreq[word] || 0;
        if (count > 0) {
          matches++;
          weightedHits += count;
        }
      }

      // Multi-word phrases: use pre-compiled RegExp patterns
      for (const { regex } of PHRASE_PATTERNS[catId]) {
        regex.lastIndex = 0; // reset stateful regex
        const phraseMatches = (combinedText.match(regex) || []).length;
        if (phraseMatches > 0) {
          matches++;
          weightedHits += phraseMatches * 2; // phrases worth double
        }
      }

      if (matches < 2) continue; // Need at least 2 indicator words

      // Score: combination of match breadth (unique words) and depth (frequency)
      const breadth = matches / cat.words.length; // 0-1
      const depth = Math.min(1, weightedHits / (freqData.totalWords * 0.1 + 1));
      const score = breadth * 0.6 + depth * 0.4;

      if (score >= MIN_SCORE) {
        results.push({
          tag: cat.tag,
          score: Math.round(score * 1000) / 1000,
          source: 'category',
          matches: matches
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Extract top keywords not covered by category matches for
   * "emergent" tags (e.g., specific technologies or topics).
   * @param {Object} wordFreq
   * @param {number} totalWords
   * @param {Set<string>} coveredWords  Words already in matched categories
   * @returns {{ tag: string, score: number, source: string }[]}
   */
  function extractKeywords(wordFreq, totalWords, coveredWords) {
    const candidates = [];

    for (const [word, count] of Object.entries(wordFreq)) {
      if (coveredWords.has(word)) continue;
      if (count < 3) continue; // Need repetition to be significant
      if (word.length < 4) continue; // Too short to be meaningful tag

      // TF-IDF-inspired: frequency relative to total, boosted by length
      const tf = count / totalWords;
      const lengthBoost = Math.min(1.5, word.length / 6);
      const score = tf * lengthBoost * 10; // Scale up

      if (score >= MIN_SCORE) {
        candidates.push({
          tag: word,
          score: Math.round(score * 1000) / 1000,
          source: 'keyword'
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /* ── Core analysis ───────────────────────────────────────── */

  /**
   * Analyze an array of messages and return suggested tags.
   * @param {{ role: string, content: string }[]} messages
   * @returns {{ tag: string, score: number, source: string }[]}
   */
  function analyze(messages) {
    if (!messages || messages.length < MIN_MESSAGES) return [];

    const freqData = buildFrequencyMap(messages);
    if (freqData.totalWords < 10) return [];

    // Build combined text for phrase matching
    const combinedText = messages
      .filter(m => m.role !== 'system')
      .map(m => (m.content || '').toLowerCase())
      .join(' ');

    // Score categories
    const categoryTags = scoreCategories(freqData, combinedText);

    // Collect words covered by matched categories
    const coveredWords = new Set();
    for (const ct of categoryTags) {
      const cat = Object.values(CATEGORIES).find(c => c.tag === ct.tag);
      if (cat) {
        for (const w of cat.words) {
          if (!w.includes(' ')) coveredWords.add(w);
        }
      }
    }

    // Extract emergent keyword tags
    const keywordTags = extractKeywords(
      freqData.wordFreq, freqData.totalWords, coveredWords
    );

    // Merge and limit
    const all = [...categoryTags, ...keywordTags];
    return all.slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Suggest tags for a saved session by ID.
   * @param {string} sessionId
   * @returns {{ tag: string, score: number, source: string }[]}
   */
  function suggestForSession(sessionId) {
    if (typeof SessionManager === 'undefined') return [];
    const sessions = SessionManager.getAll();
    const session = sessions.find(s => s.id === sessionId);
    if (!session || !session.messages) return [];
    return analyze(session.messages);
  }

  /**
   * Apply auto-detected tags to a session (skips duplicates).
   * @param {string} sessionId
   * @returns {number} Count of tags actually applied
   */
  function applyToSession(sessionId) {
    if (typeof ConversationTags === 'undefined') return 0;
    const suggestions = suggestForSession(sessionId);
    let applied = 0;
    for (const s of suggestions) {
      if (ConversationTags.addTag(sessionId, s.tag)) {
        applied++;
      }
    }
    return applied;
  }

  /**
   * Auto-tag all saved sessions that currently have no tags.
   * @returns {{ tagged: number, totalApplied: number }}
   */
  function applyToAll() {
    if (typeof SessionManager === 'undefined' || typeof ConversationTags === 'undefined') {
      return { tagged: 0, totalApplied: 0 };
    }
    const sessions = SessionManager.getAll();
    let tagged = 0;
    let totalApplied = 0;
    for (const session of sessions) {
      const existing = ConversationTags.getTagsForSession(session.id);
      if (existing.length > 0) continue; // skip already-tagged sessions
      const count = applyToSession(session.id);
      if (count > 0) {
        tagged++;
        totalApplied += count;
      }
    }
    return { tagged, totalApplied };
  }

  /* ── UI ──────────────────────────────────────────────────── */

  /**
   * Show a modal with tag suggestions for a session.
   * The user can accept/reject individual tags before applying.
   * @param {string} sessionId
   */
  function showSuggestionModal(sessionId) {
    const suggestions = suggestForSession(sessionId);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10100;' +
      'display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Modal container
    const modal = document.createElement('div');
    modal.style.cssText =
      'background:#1e1e2e;border:1px solid #444;border-radius:12px;' +
      'padding:24px;max-width:420px;width:90%;color:#e0e0e0;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    // Title
    const title = document.createElement('h3');
    title.textContent = '🏷️ Auto-Tag Suggestions';
    title.style.cssText = 'margin:0 0 6px;font-size:16px;';
    modal.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.style.cssText = 'margin:0 0 16px;font-size:12px;color:#888;';
    subtitle.textContent = 'Select tags to apply to this session:';
    modal.appendChild(subtitle);

    if (suggestions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No strong topic patterns detected. Try after more messages.';
      empty.style.cssText = 'color:#888;font-style:italic;margin:16px 0;';
      modal.appendChild(empty);
    } else {
      const checkboxes = [];

      for (const s of suggestions) {
        const existing = (typeof ConversationTags !== 'undefined')
          ? ConversationTags.getTagsForSession(sessionId)
          : [];
        const alreadyTagged = existing.includes(s.tag.toLowerCase());

        const row = document.createElement('label');
        row.style.cssText =
          'display:flex;align-items:center;gap:10px;padding:8px 0;' +
          'border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !alreadyTagged;
        cb.disabled = alreadyTagged;
        cb.dataset.tag = s.tag;
        checkboxes.push(cb);
        row.appendChild(cb);

        const color = (typeof ConversationTags !== 'undefined')
          ? ConversationTags.colorForTag(s.tag)
          : '#3498db';
        const pill = document.createElement('span');
        pill.textContent = s.tag;
        pill.style.cssText =
          'display:inline-block;padding:2px 10px;border-radius:10px;' +
          'font-size:12px;color:#fff;font-weight:500;background:' + color + ';';
        row.appendChild(pill);

        const scoreEl = document.createElement('span');
        const pct = Math.round(s.score * 100);
        scoreEl.textContent = pct + '% · ' + s.source;
        scoreEl.style.cssText = 'flex:1;font-size:11px;color:#888;text-align:right;';
        row.appendChild(scoreEl);

        if (alreadyTagged) {
          const existingLabel = document.createElement('span');
          existingLabel.textContent = '✓';
          existingLabel.style.cssText = 'font-size:14px;color:#4ade80;';
          existingLabel.title = 'Already tagged';
          row.appendChild(existingLabel);
        }

        modal.appendChild(row);
      }

      // Buttons
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText =
        'padding:8px 20px;border-radius:8px;border:1px solid #555;' +
        'background:transparent;color:inherit;cursor:pointer;font-size:13px;';
      cancelBtn.addEventListener('click', () => overlay.remove());
      btnRow.appendChild(cancelBtn);

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply Selected';
      applyBtn.style.cssText =
        'padding:8px 20px;border-radius:8px;border:none;' +
        'background:#3498db;color:#fff;cursor:pointer;font-size:13px;font-weight:500;';
      applyBtn.addEventListener('click', () => {
        let applied = 0;
        for (const cb of checkboxes) {
          if (cb.checked && !cb.disabled && typeof ConversationTags !== 'undefined') {
            if (ConversationTags.addTag(sessionId, cb.dataset.tag)) {
              applied++;
            }
          }
        }
        overlay.remove();
        // Refresh session list to show new tag pills
        if (typeof SessionManager !== 'undefined' && SessionManager.refresh) {
          SessionManager.refresh();
        }
      });
      btnRow.appendChild(applyBtn);
      modal.appendChild(btnRow);
    }

    // Close-only button when no suggestions
    if (suggestions.length === 0) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.cssText =
        'display:block;margin:12px auto 0;padding:8px 24px;border-radius:8px;' +
        'border:1px solid #555;background:transparent;color:inherit;cursor:pointer;';
      closeBtn.addEventListener('click', () => overlay.remove());
      modal.appendChild(closeBtn);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /* ── Public API ──────────────────────────────────────────── */

  return {
    analyze: analyze,
    suggestForSession: suggestForSession,
    applyToSession: applyToSession,
    applyToAll: applyToAll,
    showSuggestionModal: showSuggestionModal,
    // Expose internals for testing
    _tokenize: tokenize,
    _buildFrequencyMap: buildFrequencyMap,
    _scoreCategories: scoreCategories,
    _extractKeywords: extractKeywords,
    _CATEGORIES: CATEGORIES,
    _STOP_WORDS: STOP_WORDS,
    _MIN_SCORE: MIN_SCORE,
  };
})();

// ── Data Backup & Restore ───────────────────────────────────────────
const DataBackup = (() => {
  const FORMAT_VERSION = 1;
  const MAGIC = 'agenticchat-backup';

  /**
   * All known storage keys used by the application.
   * Each entry maps a human-readable label to its localStorage key.
   */
  const STORAGE_KEYS = {
    sessions:        'agenticchat_sessions',
    activeSession:   'agenticchat_active_session',
    snippets:        'agenticchat_snippets',
    bookmarks:       'chatBookmarks',
    reactions:       'agenticchat_reactions',
    theme:           'agenticchat_theme',
    costLog:         'agenticchat_cost_log',
    persona:         'agenticchat_persona',
    focusMode:       'ac-focus-mode',
    inputHistory:    'ac-input-history',
    scratchpad:      'agenticchat_scratchpad',
    pins:            'agenticchat_pins',
    readAloud:       'agenticchat_readaloud',
    annotations:     'agenticchat_annotations',
    chapters:        'agenticchat_chapters',
    sessionTags:     'agenticchat_session_tags',
    fmtToolbar:      'agentic_fmt_toolbar_visible',
    selectedModel:   'ac-selected-model',
    streaming:       'ac-streaming',
    showTiming:      'ac-show-timing',
    voiceLang:       'agenticchat_voice_lang',
  };

  /**
   * Collect all app data from localStorage.
   * @returns {Object} key→value map (only keys with non-null values)
   */
  function _collectData() {
    var data = Object.create(null);
    var labels = Object.keys(STORAGE_KEYS);
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      var raw = SafeStorage.get(STORAGE_KEYS[label]);
      if (raw !== null) {
        data[label] = raw;
      }
    }
    return data;
  }

  /**
   * Build a full backup object.
   * @returns {{ magic: string, version: number, timestamp: string, data: Object, stats: Object }}
   */
  function createBackup() {
    var data = _collectData();
    var labels = Object.keys(data);

    var stats = {
      keyCount: labels.length,
      totalBytes: 0,
      sessionCount: 0,
      snippetCount: 0,
      bookmarkCount: 0,
      pinCount: 0,
    };

    for (var i = 0; i < labels.length; i++) {
      stats.totalBytes += data[labels[i]].length;
    }

    try {
      var sessions = data.sessions ? JSON.parse(data.sessions) : null;
      if (sessions) {
        if (Array.isArray(sessions)) {
          stats.sessionCount = sessions.length;
        } else {
          stats.sessionCount = Object.keys(sessions).length;
        }
      }
    } catch (_) { /* non-critical */ }

    try {
      var snippets = data.snippets ? JSON.parse(data.snippets) : [];
      stats.snippetCount = Array.isArray(snippets) ? snippets.length : 0;
    } catch (_) { /* non-critical */ }

    try {
      var bookmarks = data.bookmarks ? JSON.parse(data.bookmarks) : [];
      stats.bookmarkCount = Array.isArray(bookmarks) ? bookmarks.length : 0;
    } catch (_) { /* non-critical */ }

    try {
      var pins = data.pins ? JSON.parse(data.pins) : {};
      stats.pinCount = typeof pins === 'object' ? Object.keys(pins).length : 0;
    } catch (_) { /* non-critical */ }

    return {
      magic: MAGIC,
      version: FORMAT_VERSION,
      timestamp: new Date().toISOString(),
      stats: stats,
      data: data,
    };
  }

  /**
   * Export all data as a downloadable JSON file.
   * @returns {{ success: boolean, filename: string, size: number, stats: Object }}
   */
  function exportBackup() {
    var backup = createBackup();
    var json = JSON.stringify(backup, null, 2);
    var date = new Date().toISOString().slice(0, 10);
    var filename = 'agenticchat-backup-' + date + '.json';

    if (typeof downloadBlob === 'function') {
      downloadBlob(filename, json, 'application/json');
    }

    return { success: true, filename: filename, size: json.length, stats: backup.stats };
  }

  /**
   * Validate a backup object structure.
   * @param {Object} backup
   * @returns {{ valid: boolean, error?: string, warnings: string[] }}
   */
  function validateBackup(backup) {
    var warnings = [];
    var MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB hard cap (localStorage limit)
    var MAX_VALUE_BYTES = 2 * 1024 * 1024; // 2 MB per key

    if (!backup || typeof backup !== 'object') {
      return { valid: false, error: 'Backup is not a valid object', warnings: warnings };
    }
    if (backup.magic !== MAGIC) {
      return { valid: false, error: 'Not an Agentic Chat backup file (invalid magic)', warnings: warnings };
    }
    if (typeof backup.version !== 'number' || backup.version < 1) {
      return { valid: false, error: 'Invalid backup version', warnings: warnings };
    }
    if (backup.version > FORMAT_VERSION) {
      warnings.push('Backup version ' + backup.version + ' is newer than supported (' + FORMAT_VERSION + '); some data may not restore correctly');
    }
    if (!backup.data || typeof backup.data !== 'object') {
      return { valid: false, error: 'Backup contains no data section', warnings: warnings };
    }
    if (!backup.timestamp || typeof backup.timestamp !== 'string') {
      warnings.push('Backup has no timestamp');
    }

    var dataKeys = Object.keys(backup.data);
    for (var i = 0; i < dataKeys.length; i++) {
      if (typeof STORAGE_KEYS[dataKeys[i]] === 'undefined') {
        warnings.push('Unknown data key: ' + dataKeys[i] + ' (will be skipped)');
      }
    }

    var totalBytes = 0;
    for (var j = 0; j < dataKeys.length; j++) {
      if (typeof backup.data[dataKeys[j]] !== 'string') {
        return { valid: false, error: 'Data value for "' + dataKeys[j] + '" is not a string', warnings: warnings };
      }
      var valueLen = backup.data[dataKeys[j]].length;
      if (valueLen > MAX_VALUE_BYTES) {
        return { valid: false, error: 'Data value for "' + dataKeys[j] + '" exceeds 2 MB size limit (' + Math.round(valueLen / 1024) + ' KB)', warnings: warnings };
      }
      totalBytes += valueLen;
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      return { valid: false, error: 'Backup total data size exceeds 5 MB limit (' + Math.round(totalBytes / 1024) + ' KB)', warnings: warnings };
    }

    return { valid: true, warnings: warnings };
  }

  /**
   * Restore data from a backup object.
   * @param {Object} backup - Parsed backup object
   * @param {Object} [options]
   * @param {string[]} [options.only] - Restore only these keys (selective restore)
   * @param {boolean} [options.merge] - If true, don't clear existing data before restore
   * @returns {{ success: boolean, restored: string[], skipped: string[], error?: string, warnings: string[] }}
   */
  function restoreBackup(backup, options) {
    options = options || {};
    var validation = validateBackup(backup);
    if (!validation.valid) {
      return { success: false, restored: [], skipped: [], error: validation.error, warnings: validation.warnings };
    }

    var dataKeys = Object.keys(backup.data);
    var restored = [];
    var skipped = [];
    var onlySet = null;
    if (Array.isArray(options.only) && options.only.length > 0) {
      onlySet = Object.create(null);
      for (var oi = 0; oi < options.only.length; oi++) {
        onlySet[options.only[oi]] = true;
      }
    }

    if (!options.merge) {
      var allLabels = Object.keys(STORAGE_KEYS);
      for (var ci = 0; ci < allLabels.length; ci++) {
        var label = allLabels[ci];
        if (onlySet && !onlySet[label]) continue;
        SafeStorage.remove(STORAGE_KEYS[label]);
      }
    }

    for (var i = 0; i < dataKeys.length; i++) {
      var key = dataKeys[i];

      if (typeof STORAGE_KEYS[key] === 'undefined') {
        skipped.push(key);
        continue;
      }

      if (onlySet && !onlySet[key]) {
        skipped.push(key);
        continue;
      }

      try {
        SafeStorage.set(STORAGE_KEYS[key], backup.data[key]);
        restored.push(key);
      } catch (e) {
        skipped.push(key);
        validation.warnings.push('Failed to restore "' + key + '": ' + (e.message || e));
      }
    }

    return {
      success: true,
      restored: restored,
      skipped: skipped,
      warnings: validation.warnings,
    };
  }

  /**
   * Import a backup from a File object.
   * @param {File} file
   * @param {Object} [options] - Passed to restoreBackup
   * @returns {Promise<Object>} restoreBackup result
   */
  function importFromFile(file, options) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ success: false, restored: [], skipped: [], error: 'No file provided', warnings: [] });
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        try {
          var backup = JSON.parse(reader.result);
          resolve(restoreBackup(backup, options));
        } catch (e) {
          resolve({ success: false, restored: [], skipped: [], error: 'Invalid JSON: ' + (e.message || e), warnings: [] });
        }
      };
      reader.onerror = function () {
        resolve({ success: false, restored: [], skipped: [], error: 'File read error', warnings: [] });
      };
      reader.readAsText(file);
    });
  }

  /**
   * Get a summary of currently stored data.
   * @returns {Object} Counts and total size
   */
  function getDataSummary() {
    var data = _collectData();
    var labels = Object.keys(data);
    var totalBytes = 0;
    var breakdown = [];

    for (var i = 0; i < labels.length; i++) {
      var size = data[labels[i]].length;
      totalBytes += size;
      breakdown.push({ key: labels[i], bytes: size });
    }

    breakdown.sort(function (a, b) { return b.bytes - a.bytes; });

    return {
      keyCount: labels.length,
      totalBytes: totalBytes,
      humanSize: totalBytes < 1024
        ? totalBytes + ' B'
        : totalBytes < 1048576
          ? (totalBytes / 1024).toFixed(1) + ' KB'
          : (totalBytes / 1048576).toFixed(1) + ' MB',
      breakdown: breakdown,
    };
  }

  /**
   * Delete all application data from localStorage.
   * @returns {{ cleared: string[] }}
   */
  function clearAllData() {
    var cleared = [];
    var allLabels = Object.keys(STORAGE_KEYS);
    for (var i = 0; i < allLabels.length; i++) {
      var storageKey = STORAGE_KEYS[allLabels[i]];
      if (SafeStorage.get(storageKey) !== null) {
        SafeStorage.remove(storageKey);
        cleared.push(allLabels[i]);
      }
    }
    return { cleared: cleared };
  }

  /**
   * Show the backup/restore modal UI.
   */
  function showModal() {
    var existing = document.getElementById('backup-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'backup-modal-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.6);z-index:10000;display:flex;' +
      'align-items:center;justify-content:center;';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    var modal = document.createElement('div');
    modal.style.cssText =
      'background:#1e1e2e;color:#cdd6f4;border-radius:12px;padding:24px;' +
      'max-width:440px;width:90%;max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    var title = document.createElement('h3');
    title.textContent = '\uD83D\uDCBE Backup & Restore';
    title.style.cssText = 'margin:0 0 4px;font-size:18px;';
    modal.appendChild(title);

    var subtitle = document.createElement('p');
    subtitle.style.cssText = 'margin:0 0 20px;font-size:12px;color:#888;';
    subtitle.textContent = 'Export or import all your chat data, sessions, snippets, and settings.';
    modal.appendChild(subtitle);

    var summary = getDataSummary();
    var summaryDiv = document.createElement('div');
    summaryDiv.style.cssText =
      'background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;';
    summaryDiv.innerHTML =
      '<strong>Current Data:</strong> ' + summary.keyCount + ' keys, ' + summary.humanSize + ' total';
    modal.appendChild(summaryDiv);

    var exportBtn = document.createElement('button');
    exportBtn.textContent = '\uD83D\uDCE4 Export Backup';
    exportBtn.style.cssText =
      'display:block;width:100%;padding:10px;border-radius:8px;border:none;' +
      'background:#3498db;color:#fff;cursor:pointer;font-size:14px;font-weight:500;margin-bottom:12px;';
    exportBtn.addEventListener('click', function () {
      var result = exportBackup();
      if (result.success) {
        exportBtn.textContent = '\u2705 Exported! (' + (result.size / 1024).toFixed(1) + ' KB)';
        exportBtn.style.background = '#2ecc71';
        setTimeout(function () {
          exportBtn.textContent = '\uD83D\uDCE4 Export Backup';
          exportBtn.style.background = '#3498db';
        }, 2500);
      }
    });
    modal.appendChild(exportBtn);

    var importLabel = document.createElement('label');
    importLabel.style.cssText =
      'display:block;width:100%;padding:10px;border-radius:8px;border:2px dashed #555;' +
      'text-align:center;cursor:pointer;font-size:14px;color:#888;margin-bottom:12px;' +
      'transition:border-color 0.2s;';
    importLabel.textContent = '\uD83D\uDCE5 Click to import backup file...';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      if (!fileInput.files || !fileInput.files[0]) return;
      var file = fileInput.files[0];
      importLabel.textContent = '\u23F3 Importing ' + file.name + '...';

      importFromFile(file).then(function (result) {
        if (result.success) {
          importLabel.textContent = '\u2705 Restored ' + result.restored.length + ' keys!';
          importLabel.style.borderColor = '#2ecc71';
          importLabel.style.color = '#2ecc71';
          if (result.warnings.length > 0) {
            var warnP = document.createElement('p');
            warnP.style.cssText = 'font-size:11px;color:#f39c12;margin:8px 0 0;';
            warnP.textContent = '\u26A0\uFE0F ' + result.warnings.join('; ');
            modal.insertBefore(warnP, importLabel.nextSibling);
          }
        } else {
          importLabel.textContent = '\u274C ' + (result.error || 'Import failed');
          importLabel.style.borderColor = '#e74c3c';
          importLabel.style.color = '#e74c3c';
        }
      });
    });
    importLabel.appendChild(fileInput);
    modal.appendChild(importLabel);

    var dangerDiv = document.createElement('div');
    dangerDiv.style.cssText =
      'border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;margin-top:8px;';

    var dangerTitle = document.createElement('p');
    dangerTitle.style.cssText = 'font-size:12px;color:#e74c3c;margin:0 0 8px;font-weight:600;';
    dangerTitle.textContent = '\u26A0\uFE0F Danger Zone';
    dangerDiv.appendChild(dangerTitle);

    var clearBtn = document.createElement('button');
    clearBtn.textContent = '\uD83D\uDDD1\uFE0F Clear All Data';
    clearBtn.style.cssText =
      'display:block;width:100%;padding:8px;border-radius:8px;' +
      'border:1px solid #e74c3c;background:transparent;color:#e74c3c;' +
      'cursor:pointer;font-size:13px;';
    var clearConfirm = false;
    clearBtn.addEventListener('click', function () {
      if (!clearConfirm) {
        clearBtn.textContent = '\u26A0\uFE0F Click again to confirm \u2014 this cannot be undone!';
        clearBtn.style.background = '#e74c3c';
        clearBtn.style.color = '#fff';
        clearConfirm = true;
        setTimeout(function () {
          clearBtn.textContent = '\uD83D\uDDD1\uFE0F Clear All Data';
          clearBtn.style.background = 'transparent';
          clearBtn.style.color = '#e74c3c';
          clearConfirm = false;
        }, 4000);
        return;
      }
      var result = clearAllData();
      clearBtn.textContent = '\u2705 Cleared ' + result.cleared.length + ' keys';
      clearBtn.style.background = '#2ecc71';
      clearBtn.style.borderColor = '#2ecc71';
      clearBtn.style.color = '#fff';
      clearBtn.disabled = true;
      var newSummary = getDataSummary();
      summaryDiv.innerHTML =
        '<strong>Current Data:</strong> ' + newSummary.keyCount + ' keys, ' + newSummary.humanSize + ' total';
    });
    dangerDiv.appendChild(clearBtn);
    modal.appendChild(dangerDiv);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText =
      'display:block;margin:16px auto 0;padding:8px 24px;border-radius:8px;' +
      'border:1px solid #555;background:transparent;color:inherit;cursor:pointer;font-size:13px;';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  return {
    FORMAT_VERSION: FORMAT_VERSION,
    STORAGE_KEYS: STORAGE_KEYS,
    createBackup: createBackup,
    exportBackup: exportBackup,
    validateBackup: validateBackup,
    restoreBackup: restoreBackup,
    importFromFile: importFromFile,
    getDataSummary: getDataSummary,
    clearAllData: clearAllData,
    showModal: showModal,
    _collectData: _collectData,
  };
})();


/* ---------- Response Rating ---------- */
/**
 * Rate AI responses with thumbs up/down. Tracks ratings per model for
 * satisfaction insights. Shows a dashboard with per-model approval rates,
 * trends, and exportable data.
 *
 * Public API:
 *   init()              - inject styles, attach observer
 *   decorateMessages()  - add rating buttons to assistant messages
 *   toggleDashboard()   - open/close the ratings dashboard
 *   getRatings()        - get all ratings data
 *   getModelStats()     - per-model satisfaction stats
 *   exportRatings(fmt)  - export as JSON or CSV
 *   clearAll()          - clear all ratings
 *
 * @namespace ResponseRating
 */
const ResponseRating = (() => {
  'use strict';

  const STORAGE_KEY = 'agenticchat_ratings';
  // Each rating: { messageIndex, rating ('up'|'down'), model, timestamp, snippet }
  let ratings = [];
  let dashboardEl = null;
  let dashboardOverlayEl = null;
  let styleInjected = false;

  function init() {
    load();
    injectStyles();
  }

  function load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) ratings = sanitizeStorageObject(JSON.parse(raw));
      if (!Array.isArray(ratings)) ratings = [];
    } catch (_) { ratings = []; }
  }

  function save() {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(ratings)); } catch (_) {}
  }

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .rating-bar { display:flex; gap:4px; align-items:center; margin-top:6px; }
      .rating-btn {
        background:transparent; border:1px solid #555; border-radius:6px;
        padding:2px 8px; cursor:pointer; font-size:14px; opacity:0.6;
        transition: opacity 0.2s, background 0.2s, border-color 0.2s;
      }
      .rating-btn:hover { opacity:1; background:rgba(255,255,255,0.08); }
      .rating-btn.rated-up { opacity:1; border-color:#4caf50; background:rgba(76,175,80,0.15); }
      .rating-btn.rated-down { opacity:1; border-color:#f44336; background:rgba(244,67,54,0.15); }
      .rating-label { font-size:11px; color:#888; margin-left:4px; }

      .rating-dashboard-overlay {
        position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9998;
      }
      .rating-dashboard {
        position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
        background:var(--bg, #1e1e1e); border:1px solid #444; border-radius:12px;
        padding:24px; z-index:9999; width:520px; max-width:92vw; max-height:80vh;
        overflow-y:auto; color:inherit; font-family:inherit;
      }
      .rating-dashboard h3 { margin:0 0 16px; font-size:16px; }
      .rating-dashboard table {
        width:100%; border-collapse:collapse; font-size:13px; margin:12px 0;
      }
      .rating-dashboard th, .rating-dashboard td {
        text-align:left; padding:6px 8px; border-bottom:1px solid #333;
      }
      .rating-dashboard th { font-weight:600; color:#aaa; font-size:11px; text-transform:uppercase; }
      .rating-bar-visual {
        height:14px; border-radius:4px; display:flex; overflow:hidden;
      }
      .rating-bar-up { background:#4caf50; height:100%; }
      .rating-bar-down { background:#f44336; height:100%; }
      .rating-summary { display:flex; gap:20px; margin:12px 0; flex-wrap:wrap; }
      .rating-stat { text-align:center; }
      .rating-stat-value { font-size:24px; font-weight:700; }
      .rating-stat-label { font-size:11px; color:#888; }
      .rating-actions { display:flex; gap:8px; margin-top:16px; justify-content:flex-end; }
      .rating-actions button {
        padding:6px 14px; border-radius:6px; border:1px solid #555;
        background:transparent; color:inherit; cursor:pointer; font-size:12px;
      }
      .rating-actions button:hover { background:rgba(255,255,255,0.08); }
      .rating-actions .btn-danger-sm { border-color:#f44336; color:#f44336; }
    `;
    document.head.appendChild(style);
  }

  function rate(messageIndex, rating) {
    if (typeof messageIndex !== 'number' || messageIndex < 0) return false;
    if (rating !== 'up' && rating !== 'down') return false;

    // Get model and snippet from message
    const history = ConversationManager.getHistory();
    const nonSystem = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].role !== 'system') nonSystem.push({ idx: i, msg: history[i] });
    }
    const entry = nonSystem[messageIndex];
    if (!entry || entry.msg.role !== 'assistant') return false;

    // Remove existing rating for this message index
    ratings = ratings.filter(r => r.messageIndex !== messageIndex);

    ratings.push({
      messageIndex: messageIndex,
      rating: rating,
      model: ChatConfig.MODEL || 'unknown',
      timestamp: Date.now(),
      snippet: (entry.msg.content || '').slice(0, 80),
    });
    save();
    return true;
  }

  function unrate(messageIndex) {
    const before = ratings.length;
    ratings = ratings.filter(r => r.messageIndex !== messageIndex);
    if (ratings.length < before) { save(); return true; }
    return false;
  }

  function getRating(messageIndex) {
    const r = ratings.find(r => r.messageIndex === messageIndex);
    return r ? r.rating : null;
  }

  function getRatings() { return ratings.slice(); }

  function getModelStats() {
    const stats = {};
    for (const r of ratings) {
      if (!stats[r.model]) stats[r.model] = { up: 0, down: 0, total: 0 };
      stats[r.model][r.rating]++;
      stats[r.model].total++;
    }
    return stats;
  }

  function getOverallStats() {
    let up = 0, down = 0;
    for (const r of ratings) { if (r.rating === 'up') up++; else down++; }
    return { up, down, total: up + down, rate: (up + down) > 0 ? Math.round(up / (up + down) * 100) : 0 };
  }

  /**
   * Decorate a single assistant message with rating buttons.
   * @param {Element} div - The message DOM element
   * @param {number} displayIndex - Index for rating storage
   */
  function _decorateOneRating(div, displayIndex) {
    // Remove existing
    var existing = div.querySelector('.rating-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.className = 'rating-bar';
    var current = getRating(displayIndex);

    var upBtn = document.createElement('button');
    upBtn.className = 'rating-btn' + (current === 'up' ? ' rated-up' : '');
    upBtn.textContent = '👍';
    upBtn.title = current === 'up' ? 'Remove rating' : 'Good response';
    upBtn.addEventListener('click', function () {
      if (current === 'up') { unrate(displayIndex); } else { rate(displayIndex, 'up'); }
      decorateMessages();
    });

    var downBtn = document.createElement('button');
    downBtn.className = 'rating-btn' + (current === 'down' ? ' rated-down' : '');
    downBtn.textContent = '👎';
    downBtn.title = current === 'down' ? 'Remove rating' : 'Poor response';
    downBtn.addEventListener('click', function () {
      if (current === 'down') { unrate(displayIndex); } else { rate(displayIndex, 'down'); }
      decorateMessages();
    });

    bar.appendChild(upBtn);
    bar.appendChild(downBtn);

    if (current) {
      var label = document.createElement('span');
      label.className = 'rating-label';
      label.textContent = current === 'up' ? 'Helpful' : 'Not helpful';
      bar.appendChild(label);
    }

    div.appendChild(bar);
  }

  function decorateMessages() {
    const container = document.getElementById('chat-output');
    if (!container) return;

    const msgDivs = container.querySelectorAll('.history-msg.assistant');
    msgDivs.forEach((div, displayIndex) => {
      _decorateOneRating(div, displayIndex);
    });
  }

  function openDashboard() {
    closeDashboard();
    const overlay = document.createElement('div');
    overlay.className = 'rating-dashboard-overlay';
    overlay.addEventListener('click', closeDashboard);
    document.body.appendChild(overlay);
    dashboardOverlayEl = overlay;

    const panel = document.createElement('div');
    panel.className = 'rating-dashboard';

    const overall = getOverallStats();
    const modelStats = getModelStats();

    let html = '<h3>⭐ Response Ratings Dashboard</h3>';

    // Summary
    html += '<div class="rating-summary">';
    html += `<div class="rating-stat"><div class="rating-stat-value">${overall.total}</div><div class="rating-stat-label">Total Ratings</div></div>`;
    html += `<div class="rating-stat"><div class="rating-stat-value" style="color:#4caf50">${overall.up}</div><div class="rating-stat-label">👍 Helpful</div></div>`;
    html += `<div class="rating-stat"><div class="rating-stat-value" style="color:#f44336">${overall.down}</div><div class="rating-stat-label">👎 Not Helpful</div></div>`;
    html += `<div class="rating-stat"><div class="rating-stat-value">${overall.rate}%</div><div class="rating-stat-label">Satisfaction</div></div>`;
    html += '</div>';

    // Overall bar
    if (overall.total > 0) {
      const upPct = (overall.up / overall.total * 100).toFixed(1);
      const downPct = (overall.down / overall.total * 100).toFixed(1);
      html += '<div class="rating-bar-visual">';
      html += `<div class="rating-bar-up" style="width:${upPct}%" title="${upPct}% helpful"></div>`;
      html += `<div class="rating-bar-down" style="width:${downPct}%" title="${downPct}% not helpful"></div>`;
      html += '</div>';
    }

    // Per-model table
    const models = Object.keys(modelStats).sort();
    if (models.length > 0) {
      html += '<table><thead><tr><th>Model</th><th>👍</th><th>👎</th><th>Total</th><th>Satisfaction</th><th></th></tr></thead><tbody>';
      for (const m of models) {
        const s = modelStats[m];
        const pct = Math.round(s.up / s.total * 100);
        const upW = (s.up / s.total * 100).toFixed(1);
        const downW = (s.down / s.total * 100).toFixed(1);
        html += `<tr><td>${_esc(m)}</td><td>${s.up}</td><td>${s.down}</td><td>${s.total}</td><td>${pct}%</td>`;
        html += `<td style="width:100px"><div class="rating-bar-visual"><div class="rating-bar-up" style="width:${upW}%"></div><div class="rating-bar-down" style="width:${downW}%"></div></div></td></tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#888;text-align:center;margin:20px 0">No ratings yet. Rate AI responses with 👍 or 👎 to see stats here.</p>';
    }

    // Recent ratings
    if (ratings.length > 0) {
      html += '<details><summary style="cursor:pointer;color:#aaa;font-size:12px;margin-top:12px">Recent ratings (' + ratings.length + ')</summary>';
      html += '<div style="max-height:200px;overflow-y:auto;margin-top:8px">';
      const recent = ratings.slice().reverse().slice(0, 20);
      for (const r of recent) {
        const icon = r.rating === 'up' ? '👍' : '👎';
        const time = new Date(r.timestamp).toLocaleString();
        const snippet = _esc((r.snippet || '').slice(0, 60));
        html += `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #222">${icon} <strong>${_esc(r.model)}</strong> — "${snippet}…" <span style="color:#666;float:right">${time}</span></div>`;
      }
      html += '</div></details>';
    }

    // Actions
    html += '<div class="rating-actions">';
    html += '<button onclick="ResponseRating.exportRatings(\'json\')" title="Export as JSON">📋 JSON</button>';
    html += '<button onclick="ResponseRating.exportRatings(\'csv\')" title="Export as CSV">📊 CSV</button>';
    html += '<button class="btn-danger-sm" onclick="if(confirm(\'Clear all ratings?\')){ResponseRating.clearAll();ResponseRating.closeDashboard();ResponseRating.openDashboard();}">🗑️ Clear</button>';
    html += '<button onclick="ResponseRating.closeDashboard()">Close</button>';
    html += '</div>';

    panel.innerHTML = html;
    document.body.appendChild(panel);
    dashboardEl = panel;
  }

  function closeDashboard() {
    if (dashboardOverlayEl) { dashboardOverlayEl.remove(); dashboardOverlayEl = null; }
    if (dashboardEl) { dashboardEl.remove(); dashboardEl = null; }
  }

  function toggleDashboard() {
    if (dashboardEl) closeDashboard(); else openDashboard();
  }

  function exportRatings(format) {
    if (ratings.length === 0) { alert('No ratings to export.'); return; }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (format === 'csv') {
      let csv = 'MessageIndex,Rating,Model,Timestamp,Snippet\n';
      for (const r of ratings) {
        csv += `${r.messageIndex},${r.rating},"${(r.model || '').replace(/"/g, '""')}",${new Date(r.timestamp).toISOString()},"${(r.snippet || '').replace(/"/g, '""')}"\n`;
      }
      _download(`ratings-${ts}.csv`, csv, 'text/csv');
    } else {
      _download(`ratings-${ts}.json`, JSON.stringify(ratings, null, 2), 'application/json');
    }
  }

  function clearAll() {
    ratings = [];
    save();
    decorateMessages();
  }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function _download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  return {
    init, decorateMessages, decorateOne: _decorateOneRating,
    toggleDashboard, openDashboard, closeDashboard,
    getRatings, getModelStats, getOverallStats, exportRatings, clearAll,
    rate, unrate, getRating,
  };
})();

/* ---------- Conversation Merge ---------- */
/**
 * ConversationMerge — combine 2+ saved sessions into one merged conversation.
 *
 * Features:
 *  • Multi-select sessions to merge via checkbox UI
 *  • Chronological interleaving by message timestamps (falls back to order)
 *  • Adds separator markers between source conversations
 *  • Merged session preserves tags from all sources
 *  • Option to delete originals after merge
 *  • Accessible: keyboard nav, aria labels
 */
const ConversationMerge = (() => {
  let modalEl = null;
  let overlayEl = null;
  let selected = new Set();

  function open() {
    if (modalEl) { close(); return; }
    const sessions = SessionManager.getAll();
    if (sessions.length < 2) {
      alert('Need at least 2 saved sessions to merge.');
      return;
    }
    selected.clear();
    _render(sessions);
  }

  function close() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    if (modalEl) { modalEl.remove(); modalEl = null; }
    selected.clear();
  }

  function _render(sessions) {
    // Overlay
    overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:9998;';
    overlayEl.addEventListener('click', close);
    document.body.appendChild(overlayEl);

    // Modal
    modalEl = document.createElement('div');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Merge Sessions');
    modalEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:12px;padding:20px;z-index:9999;width:480px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;font-family:inherit;';

    let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<h3 style="margin:0;font-size:16px">🔀 Merge Sessions</h3>';
    html += '<button id="merge-close" style="background:none;border:none;color:#cdd6f4;font-size:18px;cursor:pointer" title="Close">✕</button>';
    html += '</div>';
    html += '<p style="font-size:12px;color:#a6adc8;margin:0 0 10px">Select 2 or more sessions to combine into one. Messages will be interleaved chronologically.</p>';
    html += '<div id="merge-list" style="flex:1;overflow-y:auto;min-height:100px;max-height:50vh;border:1px solid #313244;border-radius:8px;padding:4px">';

    for (const s of sessions) {
      const date = new Date(s.updatedAt).toLocaleDateString();
      const preview = _esc((s.preview || '').slice(0, 50));
      html += `<label style="display:flex;align-items:center;padding:8px;border-bottom:1px solid #313244;cursor:pointer;gap:8px" title="${_esc(s.name)}">`;
      html += `<input type="checkbox" data-sid="${s.id}" class="merge-cb" style="accent-color:#89b4fa;width:16px;height:16px">`;
      html += `<div style="flex:1;min-width:0"><div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(s.name)}</div>`;
      html += `<div style="font-size:11px;color:#6c7086">${s.messageCount} msgs · ${date}${preview ? ' · ' + preview + '…' : ''}</div></div>`;
      html += '</label>';
    }
    html += '</div>';

    // Options
    html += '<div style="margin-top:10px;display:flex;align-items:center;gap:12px">';
    html += '<label style="font-size:12px;display:flex;align-items:center;gap:4px;color:#a6adc8"><input type="checkbox" id="merge-delete-originals"> Delete originals after merge</label>';
    html += '</div>';

    // Merged name
    html += '<div style="margin-top:8px">';
    html += '<input type="text" id="merge-name" placeholder="Merged session name (optional)" style="width:100%;box-sizing:border-box;padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;font-size:13px">';
    html += '</div>';

    // Status + buttons
    html += '<div id="merge-status" style="font-size:12px;color:#a6adc8;margin-top:6px;min-height:16px"></div>';
    html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">';
    html += '<button id="merge-cancel" style="padding:6px 14px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;cursor:pointer;font-size:13px">Cancel</button>';
    html += '<button id="merge-go" disabled style="padding:6px 14px;background:#89b4fa;border:none;border-radius:6px;color:#1e1e2e;cursor:pointer;font-size:13px;font-weight:600">Merge (0)</button>';
    html += '</div>';

    modalEl.innerHTML = html;
    document.body.appendChild(modalEl);

    // Events
    modalEl.querySelector('#merge-close').addEventListener('click', close);
    modalEl.querySelector('#merge-cancel').addEventListener('click', close);
    modalEl.querySelector('#merge-go').addEventListener('click', _doMerge);

    modalEl.querySelectorAll('.merge-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.sid);
        else selected.delete(cb.dataset.sid);
        _updateStatus();
      });
    });
  }

  function _updateStatus() {
    const btn = modalEl.querySelector('#merge-go');
    const status = modalEl.querySelector('#merge-status');
    const count = selected.size;
    btn.disabled = count < 2;
    btn.textContent = `Merge (${count})`;
    if (count < 2) {
      status.textContent = count === 0 ? '' : 'Select at least one more session';
    } else {
      // Count total messages
      const sessions = SessionManager.getAll().filter(s => selected.has(s.id));
      const total = sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);
      status.textContent = `${count} sessions · ${total} total messages`;
    }
  }

  function _doMerge() {
    const sessions = SessionManager.getAll().filter(s => selected.has(s.id));
    if (sessions.length < 2) return;

    const deleteOriginals = modalEl.querySelector('#merge-delete-originals').checked;
    const customName = modalEl.querySelector('#merge-name').value.trim();

    // Collect all messages with source info
    const allMessages = [];
    const sourceNames = [];

    for (const session of sessions) {
      sourceNames.push(session.name);
      if (session.messages && session.messages.length > 0) {
        for (let i = 0; i < session.messages.length; i++) {
          const msg = { ...session.messages[i] };
          // Add metadata for sorting — use timestamp if present, otherwise use order
          msg._sourceSession = session.name;
          msg._sourceOrder = i;
          msg._sourceTime = session.createdAt ? new Date(session.createdAt).getTime() + i : Date.now();
          allMessages.push(msg);
        }
      }
    }

    // Sort: group by source session creation time, keep internal order
    // This preserves conversation flow within each session
    allMessages.sort((a, b) => a._sourceTime - b._sourceTime);

    // Build merged messages with separator markers
    const merged = [];
    let currentSource = null;

    for (const msg of allMessages) {
      if (msg._sourceSession !== currentSource) {
        currentSource = msg._sourceSession;
        // Add a system separator
        merged.push({
          role: 'system',
          content: `──── Merged from: ${currentSource} ────`
        });
      }
      // Clean metadata
      const clean = { role: msg.role, content: msg.content };
      merged.push(clean);
    }

    // Create merged session name
    const mergedName = customName ||
      `Merged: ${sourceNames.slice(0, 3).join(' + ')}${sourceNames.length > 3 ? ` (+${sourceNames.length - 3})` : ''}`;

    // Merge tags from all source sessions
    const mergedTagIds = new Set();
    if (typeof ConversationTags !== 'undefined') {
      for (const session of sessions) {
        const tags = ConversationTags.getSessionTags(session.id);
        if (tags) tags.forEach(t => mergedTagIds.add(typeof t === 'string' ? t : t.id || t));
      }
    }

    // Load into conversation and save
    ConversationManager.clearHistory();
    for (const msg of merged) {
      ConversationManager.addMessage(msg.role, msg.content);
    }

    const savedSession = SessionManager.save(mergedName);

    // Apply merged tags
    if (savedSession && mergedTagIds.size > 0 && typeof ConversationTags !== 'undefined') {
      for (const tagId of mergedTagIds) {
        try { ConversationTags.addTagToSession(savedSession.id, tagId); } catch {}
      }
    }

    // Delete originals if requested
    if (deleteOriginals) {
      for (const session of sessions) {
        SessionManager.remove(session.id);
      }
    }

    // Refresh UI
    if (typeof UIController !== 'undefined' && UIController.renderMessages) {
      UIController.renderMessages();
    }
    SessionManager.refresh();
    close();
  }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  return { open, close };
})();


// 🎬 Conversation Replay ─────────────────────────────────────────────────────
const ConversationReplay = (() => {
  'use strict';

  var STATE_STOPPED = 0;
  var STATE_PLAYING = 1;
  var STATE_PAUSED  = 2;

  var state = STATE_STOPPED;
  var currentIndex = 0;
  var messages = [];
  var speed = 1;
  var timerId = null;
  var barEl = null;
  var styleInjected = false;

  var USER_DELAY_MS    = 2000;
  var ASSIST_DELAY_MS  = 3000;
  var SYSTEM_DELAY_MS  = 800;
  var SPEEDS = [0.5, 1, 2, 4];

  // ── Helpers ──

  function _delay(role) {
    var base = role === 'user' ? USER_DELAY_MS
             : role === 'assistant' ? ASSIST_DELAY_MS
             : SYSTEM_DELAY_MS;
    return Math.round(base / speed);
  }

  function _injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      '.replay-bar {',
      '  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);',
      '  background: #1e1e2e; border: 1px solid #45475a; border-radius: 12px;',
      '  padding: 8px 16px; display: flex; align-items: center; gap: 10px;',
      '  z-index: 10000; font-family: inherit; color: #cdd6f4;',
      '  box-shadow: 0 4px 24px rgba(0,0,0,.4);',
      '}',
      '.replay-bar button {',
      '  background: none; border: 1px solid #45475a; border-radius: 6px;',
      '  color: #cdd6f4; cursor: pointer; font-size: 16px; width: 36px; height: 32px;',
      '  display: flex; align-items: center; justify-content: center; padding: 0;',
      '  transition: background .15s, border-color .15s;',
      '}',
      '.replay-bar button:hover { background: #313244; border-color: #585b70; }',
      '.replay-bar button:disabled { opacity: .4; cursor: default; }',
      '.replay-bar button:disabled:hover { background: none; border-color: #45475a; }',
      '.replay-bar .replay-progress {',
      '  font-size: 13px; color: #a6adc8; min-width: 60px; text-align: center;',
      '}',
      '.replay-bar .replay-speed {',
      '  font-size: 12px; color: #89b4fa; cursor: pointer; padding: 2px 8px;',
      '  border: 1px solid #45475a; border-radius: 6px; background: none;',
      '  min-width: 40px; text-align: center;',
      '}',
      '.replay-bar .replay-speed:hover { background: #313244; }',
      '.replay-typing {',
      '  display: inline-flex; gap: 4px; padding: 8px 12px;',
      '}',
      '.replay-typing span {',
      '  width: 8px; height: 8px; border-radius: 50%; background: #6c7086;',
      '  animation: replayDot 1.2s infinite;',
      '}',
      '.replay-typing span:nth-child(2) { animation-delay: .2s; }',
      '.replay-typing span:nth-child(3) { animation-delay: .4s; }',
      '@keyframes replayDot {',
      '  0%, 60%, 100% { opacity: .3; transform: scale(.8); }',
      '  30% { opacity: 1; transform: scale(1); }',
      '}',
      '.replay-hidden { display: none !important; }',
      '.replay-reveal {',
      '  animation: replayFadeIn .3s ease-out;',
      '}',
      '@keyframes replayFadeIn {',
      '  from { opacity: 0; transform: translateY(8px); }',
      '  to   { opacity: 1; transform: translateY(0); }',
      '}',
    ].join('\n');
    document.body.appendChild(s);
  }

  // ── Control bar ──

  function _createBar() {
    _injectStyles();
    if (barEl) barEl.remove();
    barEl = document.createElement('div');
    barEl.className = 'replay-bar';
    barEl.setAttribute('role', 'toolbar');
    barEl.setAttribute('aria-label', 'Conversation Replay');
    _renderBar();
    document.body.appendChild(barEl);
  }

  function _renderBar() {
    if (!barEl) return;
    var total = messages.length;
    var idx = Math.min(currentIndex + 1, total);
    var playing = state === STATE_PLAYING;
    var stopped = state === STATE_STOPPED;

    barEl.innerHTML = [
      '<span style="font-size:14px;margin-right:4px" title="Conversation Replay">🎬</span>',
      '<button id="replay-prev" title="Previous message" aria-label="Previous"' + (currentIndex <= 0 || playing ? ' disabled' : '') + '>⏮</button>',
      '<button id="replay-play" title="' + (playing ? 'Pause' : 'Play') + '" aria-label="' + (playing ? 'Pause' : 'Play') + '">' + (playing ? '⏸' : '▶️') + '</button>',
      '<button id="replay-next" title="Next message" aria-label="Next"' + (currentIndex >= total - 1 || playing ? ' disabled' : '') + '>⏭</button>',
      '<button id="replay-stop" title="Stop replay" aria-label="Stop"' + (stopped ? ' disabled' : '') + '>⏹</button>',
      '<span class="replay-progress">' + idx + ' / ' + total + '</span>',
      '<span class="replay-speed" id="replay-speed" title="Click to change speed">' + speed + 'x</span>',
    ].join('');

    var prevBtn = barEl.querySelector('#replay-prev');
    var playBtn = barEl.querySelector('#replay-play');
    var nextBtn = barEl.querySelector('#replay-next');
    var stopBtn = barEl.querySelector('#replay-stop');
    var speedBtn = barEl.querySelector('#replay-speed');

    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (playBtn) playBtn.addEventListener('click', function() {
      if (state === STATE_PLAYING) pause();
      else play();
    });
    if (nextBtn) nextBtn.addEventListener('click', next);
    if (stopBtn) stopBtn.addEventListener('click', stop);
    if (speedBtn) speedBtn.addEventListener('click', cycleSpeed);
  }

  // ── Message visibility ──

  function _getMsgElements() {
    var output = document.getElementById('chat-output');
    if (!output) return [];
    return Array.prototype.slice.call(output.children);
  }

  function _hideAll() {
    var els = _getMsgElements();
    for (var i = 0; i < els.length; i++) {
      els[i].classList.add('replay-hidden');
      els[i].classList.remove('replay-reveal');
    }
  }

  function _showUpTo(index) {
    var els = _getMsgElements();
    for (var i = 0; i < els.length; i++) {
      if (i <= index) {
        var wasHidden = els[i].classList.contains('replay-hidden');
        els[i].classList.remove('replay-hidden');
        if (wasHidden && i === index) {
          els[i].classList.add('replay-reveal');
        }
      } else {
        els[i].classList.add('replay-hidden');
        els[i].classList.remove('replay-reveal');
      }
    }
    // Scroll revealed message into view
    if (els[index]) {
      els[index].scrollIntoView && els[index].scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  function _showTypingIndicator() {
    var output = document.getElementById('chat-output');
    if (!output) return;
    var existing = output.querySelector('.replay-typing-container');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.className = 'replay-typing-container';
    div.innerHTML = '<div class="replay-typing"><span></span><span></span><span></span></div>';
    output.appendChild(div);
    if (div.scrollIntoView) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function _removeTypingIndicator() {
    var output = document.getElementById('chat-output');
    if (!output) return;
    var indicator = output.querySelector('.replay-typing-container');
    if (indicator) indicator.remove();
  }

  // ── Playback ──

  function _scheduleNext() {
    if (state !== STATE_PLAYING) return;
    if (currentIndex >= messages.length - 1) {
      state = STATE_PAUSED;
      _removeTypingIndicator();
      _renderBar();
      return;
    }
    var nextRole = messages[currentIndex + 1] ? messages[currentIndex + 1].role : 'user';
    _showTypingIndicator();
    timerId = setTimeout(function() {
      _removeTypingIndicator();
      currentIndex++;
      _showUpTo(currentIndex);
      _renderBar();
      _scheduleNext();
    }, _delay(nextRole));
  }

  function _clearTimer() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  // ── Public API ──

  function start() {
    messages = ConversationManager.getMessages().filter(function(m) { return m.role !== 'system'; });
    if (messages.length === 0) {
      if (typeof UIController !== 'undefined') {
        UIController.setChatOutput('No messages to replay.');
      }
      return;
    }
    currentIndex = -1;
    state = STATE_STOPPED;
    _hideAll();
    _createBar();
    play();
  }

  function play() {
    if (messages.length === 0) return;
    if (currentIndex < 0) {
      currentIndex = 0;
      _showUpTo(0);
      state = STATE_PLAYING;
      _renderBar();
      _scheduleNext();
    } else if (state === STATE_PAUSED) {
      state = STATE_PLAYING;
      _renderBar();
      _scheduleNext();
    } else if (state === STATE_STOPPED) {
      currentIndex = 0;
      _hideAll();
      _showUpTo(0);
      state = STATE_PLAYING;
      _renderBar();
      _scheduleNext();
    }
  }

  function pause() {
    if (state !== STATE_PLAYING) return;
    _clearTimer();
    _removeTypingIndicator();
    state = STATE_PAUSED;
    _renderBar();
  }

  function stop() {
    _clearTimer();
    _removeTypingIndicator();
    state = STATE_STOPPED;
    speed = 1;
    // Show all messages again
    var els = _getMsgElements();
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('replay-hidden', 'replay-reveal');
    }
    currentIndex = 0;
    if (barEl) { barEl.remove(); barEl = null; }
  }

  function next() {
    if (state === STATE_PLAYING) return;
    if (currentIndex >= messages.length - 1) return;
    _clearTimer();
    _removeTypingIndicator();
    currentIndex++;
    _showUpTo(currentIndex);
    if (state === STATE_STOPPED) state = STATE_PAUSED;
    _renderBar();
  }

  function prev() {
    if (state === STATE_PLAYING) return;
    if (currentIndex <= 0) return;
    _clearTimer();
    _removeTypingIndicator();
    currentIndex--;
    _showUpTo(currentIndex);
    _renderBar();
  }

  function cycleSpeed() {
    var idx = SPEEDS.indexOf(speed);
    speed = SPEEDS[(idx + 1) % SPEEDS.length];
    _renderBar();
  }

  function isActive() {
    return state !== STATE_STOPPED;
  }

  function getState() {
    return {
      state: state === STATE_PLAYING ? 'playing' : state === STATE_PAUSED ? 'paused' : 'stopped',
      currentIndex: currentIndex,
      totalMessages: messages.length,
      speed: speed,
    };
  }

  // Keyboard handler — Escape stops replay
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && state !== STATE_STOPPED) {
      e.preventDefault();
      e.stopPropagation();
      stop();
    }
  });

  return {
    start: start,
    play: play,
    pause: pause,
    stop: stop,
    next: next,
    prev: prev,
    cycleSpeed: cycleSpeed,
    isActive: isActive,
    getState: getState,
  };
})();


/* ---------- Prompt Library ---------- */
/**
 * PromptLibrary — user-created prompt snippets with folders, search,
 * usage tracking, import/export, and one-click insert into the chat input.
 *
 * Storage key: ac_prompt_library (JSON array of prompt objects).
 * Each prompt: { id, name, text, folder, createdAt, lastUsedAt, useCount }
 */
const PromptLibrary = (() => {
  'use strict';

  const STORAGE_KEY = 'ac_prompt_library';
  let prompts = [];
  let visible = false;
  let editingId = null;

  function _load() {
    try {
      var raw = SafeStorage.get(STORAGE_KEY);
      prompts = raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch (_) { prompts = []; }
  }

  function _save() {
    SafeStorage.set(STORAGE_KEY, JSON.stringify(prompts));
  }

  function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function _getFolders() {
    var set = {};
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].folder) set[prompts[i].folder] = true;
    }
    return Object.keys(set).sort();
  }

  function _getFilteredPrompts() {
    var searchEl = document.getElementById('prompt-library-search');
    var folderEl = document.getElementById('prompt-library-folder-filter');
    var sortEl = document.getElementById('prompt-library-sort');
    var query = searchEl ? searchEl.value.toLowerCase().trim() : '';
    var folder = folderEl ? folderEl.value : '';
    var sortBy = sortEl ? sortEl.value : 'recent';

    var filtered = prompts.filter(function(p) {
      if (folder && p.folder !== folder) return false;
      if (query) {
        var haystack = (p.name + ' ' + p.text + ' ' + (p.folder || '')).toLowerCase();
        return haystack.indexOf(query) !== -1;
      }
      return true;
    });

    filtered.sort(function(a, b) {
      if (sortBy === 'alpha') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      if (sortBy === 'used') return (b.useCount || 0) - (a.useCount || 0);
      // recent — by lastUsedAt desc, then createdAt desc
      return (b.lastUsedAt || b.createdAt || 0) - (a.lastUsedAt || a.createdAt || 0);
    });

    return filtered;
  }

  function _renderFolderFilter() {
    var el = document.getElementById('prompt-library-folder-filter');
    if (!el) return;
    var current = el.value;
    var folders = _getFolders();
    el.innerHTML = '<option value="">All Folders</option>';
    for (var i = 0; i < folders.length; i++) {
      var opt = document.createElement('option');
      opt.value = folders[i];
      opt.textContent = '📁 ' + folders[i];
      el.appendChild(opt);
    }
    el.value = current;

    // Also update datalist in save modal
    var dl = document.getElementById('prompt-library-folder-suggestions');
    if (dl) {
      dl.innerHTML = '';
      for (var j = 0; j < folders.length; j++) {
        var o = document.createElement('option');
        o.value = folders[j];
        dl.appendChild(o);
      }
    }
  }

  function _renderList() {
    var listEl = document.getElementById('prompt-library-list');
    var countEl = document.getElementById('prompt-library-count');
    if (!listEl) return;

    var filtered = _getFilteredPrompts();
    if (countEl) countEl.textContent = filtered.length + ' prompt' + (filtered.length !== 1 ? 's' : '');

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="prompt-library-empty">No prompts yet. Click ➕ New to save one!</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var p = filtered[i];
      var preview = p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text;
      html += '<div class="prompt-library-item" data-id="' + p.id + '">';
      html += '<div class="prompt-library-item-header">';
      html += '<span class="prompt-library-item-name">' + _esc(p.name || 'Untitled') + '</span>';
      if (p.folder) html += '<span class="prompt-library-item-folder">📁 ' + _esc(p.folder) + '</span>';
      html += '</div>';
      html += '<div class="prompt-library-item-preview">' + _esc(preview) + '</div>';
      html += '<div class="prompt-library-item-meta">';
      html += '<span>Used ' + (p.useCount || 0) + '×</span>';
      html += '</div>';
      html += '<div class="prompt-library-item-actions">';
      html += '<button class="btn-sm pl-use-btn" title="Insert into chat input">▶ Use</button>';
      html += '<button class="btn-sm pl-edit-btn" title="Edit this prompt">✏️</button>';
      html += '<button class="btn-sm btn-danger-sm pl-delete-btn" title="Delete this prompt">🗑️</button>';
      html += '</div>';
      html += '</div>';
    }
    listEl.innerHTML = html;

    // Bind actions
    var items = listEl.querySelectorAll('.prompt-library-item');
    for (var j = 0; j < items.length; j++) {
      (function(item) {
        var id = item.getAttribute('data-id');
        var useBtn = item.querySelector('.pl-use-btn');
        var editBtn = item.querySelector('.pl-edit-btn');
        var delBtn = item.querySelector('.pl-delete-btn');
        if (useBtn) useBtn.addEventListener('click', function(e) { e.stopPropagation(); usePrompt(id); });
        if (editBtn) editBtn.addEventListener('click', function(e) { e.stopPropagation(); openEditModal(id); });
        if (delBtn) delBtn.addEventListener('click', function(e) { e.stopPropagation(); deletePrompt(id); });
        // Double-click item to use
        item.addEventListener('dblclick', function() { usePrompt(id); });
      })(items[j]);
    }
  }

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function toggle() {
    visible ? close() : open();
  }

  function open() {
    _load();
    var panel = document.getElementById('prompt-library-panel');
    var overlay = document.getElementById('prompt-library-overlay');
    if (panel) panel.style.display = '';
    if (overlay) overlay.style.display = '';
    visible = true;
    _renderFolderFilter();
    _renderList();
    var searchEl = document.getElementById('prompt-library-search');
    if (searchEl) { searchEl.value = ''; searchEl.focus(); }
  }

  function close() {
    var panel = document.getElementById('prompt-library-panel');
    var overlay = document.getElementById('prompt-library-overlay');
    if (panel) panel.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    visible = false;
  }

  function isOpen() { return visible; }

  function addPrompt(name, text, folder) {
    _load();
    if (!name || !text) return null;
    var p = {
      id: _genId(),
      name: name.trim(),
      text: text.trim(),
      folder: (folder || '').trim() || null,
      createdAt: Date.now(),
      lastUsedAt: null,
      useCount: 0
    };
    prompts.push(p);
    _save();
    return p;
  }

  function updatePrompt(id, updates) {
    _load();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === id) {
        if (updates.name !== undefined) prompts[i].name = updates.name.trim();
        if (updates.text !== undefined) prompts[i].text = updates.text.trim();
        if (updates.folder !== undefined) prompts[i].folder = updates.folder.trim() || null;
        _save();
        return prompts[i];
      }
    }
    return null;
  }

  function deletePrompt(id) {
    _load();
    var len = prompts.length;
    prompts = prompts.filter(function(p) { return p.id !== id; });
    _save();
    _renderFolderFilter();
    _renderList();
    return prompts.length < len;
  }

  function usePrompt(id) {
    _load();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === id) {
        prompts[i].useCount = (prompts[i].useCount || 0) + 1;
        prompts[i].lastUsedAt = Date.now();
        _save();
        // Insert into chat input
        var input = document.getElementById('chat-input');
        if (input) {
          input.value = prompts[i].text;
          input.focus();
          if (typeof UIController !== 'undefined' && UIController.updateCharCount) {
            UIController.updateCharCount(input.value.length);
          }
        }
        close();
        return prompts[i];
      }
    }
    return null;
  }

  function getAll() {
    _load();
    return prompts.slice();
  }

  function getById(id) {
    _load();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === id) return prompts[i];
    }
    return null;
  }

  function openSaveModal(prefillText) {
    editingId = null;
    var modal = document.getElementById('prompt-library-save-modal');
    var titleEl = document.getElementById('prompt-library-modal-title');
    var nameInput = document.getElementById('prompt-library-name-input');
    var folderInput = document.getElementById('prompt-library-folder-input');
    var textInput = document.getElementById('prompt-library-text-input');
    if (titleEl) titleEl.textContent = 'Save Prompt';
    if (nameInput) nameInput.value = '';
    if (folderInput) folderInput.value = '';
    if (textInput) textInput.value = prefillText || '';
    if (modal) modal.style.display = '';
    _renderFolderFilter(); // update datalist
    if (nameInput) nameInput.focus();
  }

  function openEditModal(id) {
    var p = getById(id);
    if (!p) return;
    editingId = id;
    var modal = document.getElementById('prompt-library-save-modal');
    var titleEl = document.getElementById('prompt-library-modal-title');
    var nameInput = document.getElementById('prompt-library-name-input');
    var folderInput = document.getElementById('prompt-library-folder-input');
    var textInput = document.getElementById('prompt-library-text-input');
    if (titleEl) titleEl.textContent = 'Edit Prompt';
    if (nameInput) nameInput.value = p.name || '';
    if (folderInput) folderInput.value = p.folder || '';
    if (textInput) textInput.value = p.text || '';
    if (modal) modal.style.display = '';
    _renderFolderFilter();
    if (nameInput) nameInput.focus();
  }

  function closeSaveModal() {
    var modal = document.getElementById('prompt-library-save-modal');
    if (modal) modal.style.display = 'none';
    editingId = null;
  }

  function confirmSave() {
    var nameInput = document.getElementById('prompt-library-name-input');
    var folderInput = document.getElementById('prompt-library-folder-input');
    var textInput = document.getElementById('prompt-library-text-input');
    var name = nameInput ? nameInput.value.trim() : '';
    var folder = folderInput ? folderInput.value.trim() : '';
    var text = textInput ? textInput.value.trim() : '';
    if (!name || !text) return null;

    var result;
    if (editingId) {
      result = updatePrompt(editingId, { name: name, text: text, folder: folder });
    } else {
      result = addPrompt(name, text, folder);
    }
    closeSaveModal();
    _renderFolderFilter();
    _renderList();
    return result;
  }

  function exportPrompts() {
    _load();
    var json = JSON.stringify(prompts, null, 2);
    if (typeof downloadBlob === 'function') {
      downloadBlob(json, 'prompt-library.json', 'application/json');
    }
    return json;
  }

  function importPrompts(jsonStr) {
    var MAX_IMPORT_PROMPTS = 5000;
    var MAX_PROMPT_TEXT = 50000; // 50 KB per prompt text
    var MAX_PROMPT_NAME = 500;
    try {
      var imported = JSON.parse(jsonStr);
      if (!Array.isArray(imported)) return 0;
      if (imported.length > MAX_IMPORT_PROMPTS) return -1;
      _load();
      var existingIds = {};
      for (var i = 0; i < prompts.length; i++) existingIds[prompts[i].id] = true;
      var added = 0;
      for (var j = 0; j < imported.length; j++) {
        var p = imported[j];
        if (!p.name || !p.text) continue;
        if (typeof p.name !== 'string' || typeof p.text !== 'string') continue;
        if (p.name.length > MAX_PROMPT_NAME || p.text.length > MAX_PROMPT_TEXT) continue;
        if (existingIds[p.id]) {
          // Update existing
          updatePrompt(p.id, { name: p.name, text: p.text, folder: p.folder || '' });
        } else {
          p.id = p.id || _genId();
          p.createdAt = p.createdAt || Date.now();
          p.useCount = p.useCount || 0;
          p.lastUsedAt = p.lastUsedAt || null;
          prompts.push(p);
          added++;
        }
      }
      _save();
      _renderFolderFilter();
      _renderList();
      return added;
    } catch (_) { return -1; }
  }

  function clearAll() {
    prompts = [];
    _save();
    _renderFolderFilter();
    _renderList();
  }

  function saveCurrentInput() {
    var input = document.getElementById('chat-input');
    var text = input ? input.value.trim() : '';
    if (!text) return;
    openSaveModal(text);
  }

  function init() {
    _load();

    var btn = document.getElementById('prompt-library-btn');
    if (btn) btn.addEventListener('click', toggle);

    var closeBtn = document.getElementById('prompt-library-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    var overlay = document.getElementById('prompt-library-overlay');
    if (overlay) overlay.addEventListener('click', close);

    var addBtn = document.getElementById('prompt-library-add-btn');
    if (addBtn) addBtn.addEventListener('click', function() { openSaveModal(); });

    var exportBtn = document.getElementById('prompt-library-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportPrompts);

    var importBtn = document.getElementById('prompt-library-import-btn');
    if (importBtn) importBtn.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', function() {
        if (!input.files || !input.files[0]) return;
        var reader = new FileReader();
        reader.onload = function() { importPrompts(reader.result); };
        reader.readAsText(input.files[0]);
      });
      input.click();
    });

    var confirmBtn = document.getElementById('prompt-library-confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmSave);

    var cancelBtn = document.getElementById('prompt-library-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeSaveModal);

    var searchEl = document.getElementById('prompt-library-search');
    if (searchEl) searchEl.addEventListener('input', _renderList);

    var folderFilter = document.getElementById('prompt-library-folder-filter');
    if (folderFilter) folderFilter.addEventListener('change', _renderList);

    var sortEl = document.getElementById('prompt-library-sort');
    if (sortEl) sortEl.addEventListener('change', _renderList);

    // Ctrl+L shortcut
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !e.shiftKey && !e.altKey) {
        // Don't override browser address bar if nothing else is focused
        var tag = (document.activeElement || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        toggle();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    toggle: toggle,
    open: open,
    close: close,
    isOpen: isOpen,
    addPrompt: addPrompt,
    updatePrompt: updatePrompt,
    deletePrompt: deletePrompt,
    usePrompt: usePrompt,
    getAll: getAll,
    getById: getById,
    openSaveModal: openSaveModal,
    openEditModal: openEditModal,
    closeSaveModal: closeSaveModal,
    confirmSave: confirmSave,
    exportPrompts: exportPrompts,
    importPrompts: importPrompts,
    clearAll: clearAll,
    saveCurrentInput: saveCurrentInput,
    init: init,
  };
})();

/* ============================================================
 * MessageTranslator — inline message translation via OpenAI API
 *
 * Adds a 🌐 button to every message. Click to pick a target language,
 * then the message content is translated using the configured model
 * and shown inline below the original text. Translations are cached
 * in localStorage so repeated requests are instant.
 *
 * Keyboard shortcut: Ctrl+Shift+T (when a message is hovered).
 * ============================================================ */
const MessageTranslator = (() => {
  'use strict';

  const STORAGE_KEY = 'agenticchat_translations';
  const LANGUAGES = [
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'nl', name: 'Dutch' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'bn', name: 'Bengali' },
    { code: 'tr', name: 'Turkish' },
    { code: 'pl', name: 'Polish' },
    { code: 'sv', name: 'Swedish' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'th', name: 'Thai' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'en', name: 'English' },
  ];

  let cache = {};
  let styleInjected = false;
  let activeDropdown = null;
  let lastPreferredLang = 'es';
  let hoveredMsgIndex = -1;

  function init() {
    load();
    injectStyles();

    document.addEventListener('click', function (e) {
      if (activeDropdown && !activeDropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        if (hoveredMsgIndex >= 0) {
          quickTranslate(hoveredMsgIndex, lastPreferredLang);
        }
      }
    });
  }

  function load() {
    try {
      var raw = SafeStorage.get(STORAGE_KEY);
      if (raw) cache = sanitizeStorageObject(JSON.parse(raw));
      if (typeof cache !== 'object' || cache === null) cache = {};
    } catch (_) { cache = {}; }
    var pref = SafeStorage.get('agenticchat_translate_lang');
    if (pref) lastPreferredLang = pref;
  }

  function save() {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(cache)); } catch (_) {}
  }

  function savePref() {
    try { SafeStorage.set('agenticchat_translate_lang', lastPreferredLang); } catch (_) {}
  }

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.translate-btn { background:transparent; border:1px solid #555; border-radius:6px;',
      '  padding:2px 8px; cursor:pointer; font-size:13px; opacity:0.6;',
      '  transition:opacity 0.2s, background 0.2s; margin-left:4px; }',
      '.translate-btn:hover { opacity:1; background:rgba(255,255,255,0.08); }',
      '.translate-dropdown {',
      '  position:absolute; z-index:9999; background:var(--bg,#1e1e1e);',
      '  border:1px solid #555; border-radius:8px; padding:6px 0;',
      '  min-width:180px; max-height:300px; overflow-y:auto;',
      '  box-shadow:0 4px 16px rgba(0,0,0,0.3); }',
      '.translate-dropdown-item {',
      '  padding:6px 14px; cursor:pointer; font-size:13px; color:inherit;',
      '  transition:background 0.15s; }',
      '.translate-dropdown-item:hover { background:rgba(255,255,255,0.1); }',
      '.translate-dropdown-item.preferred { font-weight:600; }',
      '.translate-dropdown-search {',
      '  width:calc(100% - 16px); margin:4px 8px 6px; padding:4px 8px;',
      '  border:1px solid #555; border-radius:4px; background:transparent;',
      '  color:inherit; font-size:12px; outline:none; }',
      '.translate-result {',
      '  margin-top:8px; padding:10px 12px; border-radius:8px;',
      '  background:rgba(100,180,255,0.08); border-left:3px solid #5b9bd5;',
      '  font-size:13px; line-height:1.5; position:relative; }',
      '.translate-result-header {',
      '  font-size:11px; color:#888; margin-bottom:4px; display:flex;',
      '  justify-content:space-between; align-items:center; }',
      '.translate-result-actions { display:flex; gap:4px; }',
      '.translate-result-actions button {',
      '  background:transparent; border:none; cursor:pointer; font-size:12px;',
      '  opacity:0.6; padding:2px 4px; }',
      '.translate-result-actions button:hover { opacity:1; }',
      '.translate-loading { color:#888; font-style:italic; font-size:12px; margin-top:6px; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function cacheKey(msgIndex, langCode) {
    return msgIndex + ':' + langCode;
  }

  function getCached(msgIndex, langCode) {
    return cache[cacheKey(msgIndex, langCode)] || null;
  }

  function setCache(msgIndex, langCode, translation) {
    cache[cacheKey(msgIndex, langCode)] = translation;
    save();
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
  }

  function showDropdown(btn, msgIndex) {
    closeDropdown();

    var dropdown = document.createElement('div');
    dropdown.className = 'translate-dropdown';

    var search = document.createElement('input');
    search.className = 'translate-dropdown-search';
    search.placeholder = 'Search language...';
    search.setAttribute('type', 'text');
    dropdown.appendChild(search);

    function renderItems(filter) {
      var existing = dropdown.querySelectorAll('.translate-dropdown-item');
      existing.forEach(function (el) { el.remove(); });

      var filtered = LANGUAGES.filter(function (l) {
        if (!filter) return true;
        return l.name.toLowerCase().indexOf(filter.toLowerCase()) >= 0 ||
               l.code.toLowerCase().indexOf(filter.toLowerCase()) >= 0;
      });

      filtered.sort(function (a, b) {
        if (a.code === lastPreferredLang) return -1;
        if (b.code === lastPreferredLang) return 1;
        return 0;
      });

      filtered.forEach(function (lang) {
        var item = document.createElement('div');
        item.className = 'translate-dropdown-item';
        if (lang.code === lastPreferredLang) item.classList.add('preferred');
        item.textContent = lang.name;
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          lastPreferredLang = lang.code;
          savePref();
          closeDropdown();
          translateMessage(msgIndex, lang.code, lang.name);
        });
        dropdown.appendChild(item);
      });
    }

    search.addEventListener('input', function () {
      renderItems(search.value);
    });

    renderItems('');

    var rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    setTimeout(function () { search.focus(); }, 50);
  }

  function getMessageContent(msgIndex) {
    var history = ConversationManager.getHistory();
    var nonSystem = [];
    for (var i = 0; i < history.length; i++) {
      if (history[i].role !== 'system') nonSystem.push(history[i]);
    }
    return nonSystem[msgIndex] ? nonSystem[msgIndex].content : null;
  }

  async function translateMessage(msgIndex, langCode, langName) {
    var content = getMessageContent(msgIndex);
    if (!content) return;

    var cached = getCached(msgIndex, langCode);
    if (cached) {
      showTranslation(msgIndex, langCode, langName, cached);
      return;
    }

    showLoading(msgIndex);

    var key = ApiKeyManager.getKey();
    if (!key) {
      removeLoading(msgIndex);
      alert('Please set your OpenAI API key first.');
      return;
    }

    try {
      var rsp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: ChatConfig.MODEL,
          messages: [
            { role: 'system', content: 'You are a translator. Translate the following text to ' + langName + '. Return ONLY the translation, nothing else. Preserve formatting, code blocks, and markdown.' },
            { role: 'user', content: content }
          ],
          max_tokens: 4096,
          temperature: 0.3
        })
      });

      removeLoading(msgIndex);

      if (!rsp.ok) {
        var errData = await rsp.json().catch(function () { return {}; });
        alert('Translation failed: ' + (errData.error ? errData.error.message : rsp.statusText));
        return;
      }

      var data = await rsp.json();
      var translation = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';

      if (!translation) {
        alert('No translation returned.');
        return;
      }

      setCache(msgIndex, langCode, translation);
      showTranslation(msgIndex, langCode, langName, translation);

      if (typeof CostDashboard !== 'undefined' && data.usage) {
        CostDashboard.trackUsage(data.usage);
      }
    } catch (err) {
      removeLoading(msgIndex);
      if (err.name !== 'AbortError') {
        alert('Translation error: ' + err.message);
      }
    }
  }

  function quickTranslate(msgIndex, langCode) {
    var lang = LANGUAGES.find(function (l) { return l.code === langCode; });
    if (lang) return translateMessage(msgIndex, langCode, lang.name);
  }

  function showLoading(msgIndex) {
    var container = document.getElementById('chat-output');
    if (!container) return;
    var msgs = container.querySelectorAll('.history-msg');
    if (msgIndex >= msgs.length) return;
    removeLoading(msgIndex);
    var loading = document.createElement('div');
    loading.className = 'translate-loading';
    loading.setAttribute('data-translate-loading', msgIndex);
    loading.textContent = '\uD83C\uDF10 Translating...';
    msgs[msgIndex].appendChild(loading);
  }

  function removeLoading(msgIndex) {
    var el = document.querySelector('[data-translate-loading="' + msgIndex + '"]');
    if (el) el.remove();
  }

  function showTranslation(msgIndex, langCode, langName, text) {
    var container = document.getElementById('chat-output');
    if (!container) return;
    var msgs = container.querySelectorAll('.history-msg');
    if (msgIndex >= msgs.length) return;

    var existing = msgs[msgIndex].querySelector('.translate-result');
    if (existing) existing.remove();

    var result = document.createElement('div');
    result.className = 'translate-result';

    var header = document.createElement('div');
    header.className = 'translate-result-header';

    var label = document.createElement('span');
    label.textContent = '\uD83C\uDF10 ' + langName;

    var actions = document.createElement('div');
    actions.className = 'translate-result-actions';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '\uD83D\uDCCB';
    copyBtn.title = 'Copy translation';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = '\u2705';
        setTimeout(function () { copyBtn.textContent = '\uD83D\uDCCB'; }, 1500);
      });
    });

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Hide translation';
    closeBtn.addEventListener('click', function () {
      result.remove();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    header.appendChild(label);
    header.appendChild(actions);

    var body = document.createElement('div');
    body.textContent = text;

    result.appendChild(header);
    result.appendChild(body);
    msgs[msgIndex].appendChild(result);
  }

  /**
   * Decorate a single message element with a translate button.
   * @param {Element} div - The message DOM element
   * @param {number} idx - Display index of the message
   */
  function _decorateOneTranslate(div, idx) {
    if (div.querySelector('.translate-btn')) return;

    div.addEventListener('mouseenter', function () { hoveredMsgIndex = idx; });
    div.addEventListener('mouseleave', function () {
      if (hoveredMsgIndex === idx) hoveredMsgIndex = -1;
    });

    var btn = document.createElement('button');
    btn.className = 'translate-btn';
    btn.textContent = '\uD83C\uDF10';
    btn.title = 'Translate message (Ctrl+Shift+T)';
    btn.setAttribute('aria-label', 'Translate message');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      showDropdown(btn, idx);
    });

    var roleEl = div.querySelector('.msg-role');
    if (roleEl) {
      roleEl.appendChild(btn);
    } else {
      div.insertBefore(btn, div.firstChild);
    }
  }

  function decorateMessages() {
    var container = document.getElementById('chat-output');
    if (!container) return;

    var msgs = container.querySelectorAll('.history-msg');
    msgs.forEach(function (div, idx) {
      _decorateOneTranslate(div, idx);
    });
  }

  function clearCache() {
    cache = {};
    save();
  }

  function getLanguages() {
    return LANGUAGES.slice();
  }

  function getPreferredLanguage() {
    return lastPreferredLang;
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    decorateMessages: decorateMessages,
    decorateOne: _decorateOneTranslate,
    translateMessage: translateMessage,
    quickTranslate: quickTranslate,
    clearCache: clearCache,
    getLanguages: getLanguages,
    getPreferredLanguage: getPreferredLanguage,
    init: init,
  };
})();

/* ═══════════════════════════════════════════════════════════════════
 *  ModelCompare – Send the same prompt to multiple models, compare
 *  results side-by-side with timing and token metrics.
 * ═══════════════════════════════════════════════════════════════════ */
const ModelCompare = (() => {
  const STORAGE_KEY = 'ac-model-compare-history';
  const MAX_HISTORY = 50;
  let _history = [];

  /** Load history from localStorage. */
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _history = raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch (_) { _history = []; }
  }

  /** Save history to localStorage. */
  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_history));
    } catch (_) { /* quota */ }
  }

  /**
   * Run a comparison: send the same prompt to multiple models in parallel.
   *
   * @param {string} prompt - The user prompt to compare.
   * @param {string[]} modelIds - Array of model IDs (at least 2).
   * @param {Object} [opts] - Optional config.
   * @param {string} [opts.systemPrompt] - Override system prompt.
   * @param {number} [opts.temperature] - Temperature for all models.
   * @returns {Promise<Object>} Comparison result with per-model responses.
   */
  async function compare(prompt, modelIds, opts) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('ModelCompare: prompt is required');
    }
    if (!Array.isArray(modelIds) || modelIds.length < 2) {
      throw new Error('ModelCompare: at least 2 model IDs required');
    }

    const options = opts || {};
    const systemPrompt = options.systemPrompt || ChatConfig.SYSTEM_PROMPT;
    const temperature = typeof options.temperature === 'number' ? options.temperature : undefined;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    const startTime = Date.now();

    // Run all models in parallel
    const results = await Promise.allSettled(
      modelIds.map(function (modelId) {
        const t0 = Date.now();
        return _callModel(messages, modelId, temperature).then(function (resp) {
          return {
            modelId: modelId,
            modelLabel: _getLabel(modelId),
            content: resp.content,
            tokens: resp.tokens || null,
            latencyMs: Date.now() - t0,
            error: null
          };
        }).catch(function (err) {
          return {
            modelId: modelId,
            modelLabel: _getLabel(modelId),
            content: null,
            tokens: null,
            latencyMs: Date.now() - t0,
            error: err.message || 'Unknown error'
          };
        });
      })
    );

    const responses = results.map(function (r) {
      return r.status === 'fulfilled' ? r.value : {
        modelId: 'unknown', modelLabel: 'Unknown', content: null,
        tokens: null, latencyMs: 0, error: r.reason ? r.reason.message : 'Failed'
      };
    });

    const comparison = {
      id: _generateId(),
      prompt: prompt,
      systemPrompt: systemPrompt,
      modelIds: modelIds.slice(),
      responses: responses,
      totalMs: Date.now() - startTime,
      createdAt: new Date().toISOString(),
      winner: null
    };

    _history.unshift(comparison);
    if (_history.length > MAX_HISTORY) _history.length = MAX_HISTORY;
    _save();

    return comparison;
  }

  /**
   * Call a single model. Wraps the existing callOpenAI flow but with
   * a specific model override.
   */
  async function _callModel(messages, modelId, temperature) {
    const apiKey = typeof ChatConfig !== 'undefined' ? ChatConfig.API_KEY : '';
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    const body = {
      model: modelId,
      messages: messages
    };
    if (typeof temperature === 'number') {
      body.temperature = temperature;
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(function () { return ''; });
      throw new Error('HTTP ' + resp.status + ': ' + errText.slice(0, 200));
    }

    const data = await resp.json();
    const choice = data.choices && data.choices[0];
    return {
      content: choice ? (choice.message ? choice.message.content : '') : '',
      tokens: data.usage || null
    };
  }

  /** Get human-readable label for a model ID. */
  function _getLabel(modelId) {
    if (typeof ChatConfig !== 'undefined' && ChatConfig.AVAILABLE_MODELS) {
      const match = ChatConfig.AVAILABLE_MODELS.find(function (m) {
        return m.id === modelId;
      });
      if (match) return match.label;
    }
    return modelId;
  }

  /** Generate a simple unique ID. */
  function _generateId() {
    return 'cmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Set a winner for a comparison.
   * @param {string} comparisonId - ID from compare().
   * @param {string} winnerModelId - Model ID that won.
   * @returns {boolean} True if updated.
   */
  function setWinner(comparisonId, winnerModelId) {
    const entry = _history.find(function (c) { return c.id === comparisonId; });
    if (!entry) return false;
    entry.winner = winnerModelId;
    _save();
    return true;
  }

  /**
   * Get comparison history.
   * @param {number} [limit] - Max entries to return.
   * @returns {Object[]} History entries (newest first).
   */
  function getHistory(limit) {
    _load();
    if (typeof limit === 'number' && limit > 0) return _history.slice(0, limit);
    return _history.slice();
  }

  /**
   * Get a specific comparison by ID.
   * @param {string} id - Comparison ID.
   * @returns {Object|null}
   */
  function getComparison(id) {
    return _history.find(function (c) { return c.id === id; }) || null;
  }

  /**
   * Build a side-by-side HTML comparison view.
   * @param {Object} comparison - Result from compare().
   * @returns {string} HTML string.
   */
  function buildComparisonView(comparison) {
    if (!comparison || !comparison.responses) return '';

    function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    const colWidth = Math.floor(100 / comparison.responses.length);

    let html = '<div class="mc-comparison" data-mc-id="' + esc(comparison.id) + '">';
    html += '<div class="mc-prompt"><strong>Prompt:</strong> ' + esc(comparison.prompt) + '</div>';
    html += '<div class="mc-grid" style="display:grid;grid-template-columns:repeat(' +
      comparison.responses.length + ',1fr);gap:12px;">';

    for (let i = 0; i < comparison.responses.length; i++) {
      const r = comparison.responses[i];
      const isWinner = comparison.winner === r.modelId;

      html += '<div class="mc-card' + (isWinner ? ' mc-winner' : '') + '">';
      html += '<div class="mc-card-header">';
      html += '<span class="mc-model-name">' + esc(r.modelLabel) + '</span>';
      if (isWinner) html += ' <span class="mc-crown">👑</span>';
      html += '</div>';

      if (r.error) {
        html += '<div class="mc-error">❌ ' + esc(r.error) + '</div>';
      } else {
        html += '<div class="mc-content">' + esc(r.content) + '</div>';
      }

      html += '<div class="mc-metrics">';
      html += '<span class="mc-metric">⏱ ' + r.latencyMs + 'ms</span>';
      if (r.tokens) {
        if (r.tokens.prompt_tokens != null) {
          html += '<span class="mc-metric">📥 ' + r.tokens.prompt_tokens + '</span>';
        }
        if (r.tokens.completion_tokens != null) {
          html += '<span class="mc-metric">📤 ' + r.tokens.completion_tokens + '</span>';
        }
        if (r.tokens.total_tokens != null) {
          html += '<span class="mc-metric">Σ ' + r.tokens.total_tokens + '</span>';
        }
      }
      html += '</div>';

      if (!comparison.winner) {
        html += '<button class="mc-vote-btn" data-mc-model="' + esc(r.modelId) +
          '" data-mc-id="' + esc(comparison.id) + '">Pick as best</button>';
      }

      html += '</div>';
    }

    html += '</div>';
    html += '<div class="mc-footer">Total: ' + comparison.totalMs + 'ms | ' +
      new Date(comparison.createdAt).toLocaleString() + '</div>';
    html += '</div>';

    return html;
  }

  /**
   * Get win/loss statistics per model across all comparisons.
   * @returns {Object<string, {wins:number, appearances:number, avgLatencyMs:number}>}
   */
  function getModelStats() {
    _load();
    const stats = {};
    for (let i = 0; i < _history.length; i++) {
      const c = _history[i];
      for (let j = 0; j < c.responses.length; j++) {
        const r = c.responses[j];
        if (!stats[r.modelId]) {
          stats[r.modelId] = { wins: 0, appearances: 0, totalLatencyMs: 0, label: r.modelLabel };
        }
        stats[r.modelId].appearances++;
        stats[r.modelId].totalLatencyMs += (r.latencyMs || 0);
        if (c.winner === r.modelId) stats[r.modelId].wins++;
      }
    }
    const result = {};
    for (const id in stats) {
      if (stats.hasOwnProperty(id)) {
        result[id] = {
          label: stats[id].label,
          wins: stats[id].wins,
          appearances: stats[id].appearances,
          winRate: stats[id].appearances > 0 ?
            Math.round((stats[id].wins / stats[id].appearances) * 1000) / 1000 : 0,
          avgLatencyMs: stats[id].appearances > 0 ?
            Math.round(stats[id].totalLatencyMs / stats[id].appearances) : 0
        };
      }
    }
    return result;
  }

  /** Clear all comparison history. */
  function clearHistory() {
    _history = [];
    _save();
  }

  /**
   * Export comparison history as JSON string.
   * @returns {string}
   */
  function exportHistory() {
    _load();
    return JSON.stringify(_history, null, 2);
  }

  // Initialize on load
  _load();

  return {
    compare: compare,
    setWinner: setWinner,
    getHistory: getHistory,
    getComparison: getComparison,
    buildComparisonView: buildComparisonView,
    getModelStats: getModelStats,
    clearHistory: clearHistory,
    exportHistory: exportHistory
  };
})();

/* ---------- Model Compare Panel ---------- */
/**
 * Interactive UI panel for comparing AI model responses side-by-side.
 *
 * Wraps the {@link ModelCompare} logic module with a full panel experience:
 * - Model picker with checkboxes for selecting 2+ models to compare
 * - Prompt input area with quick-fill from current chat input
 * - Side-by-side response cards with latency/token metrics
 * - Vote buttons to pick the best response per comparison
 * - Comparison history with re-viewable past comparisons
 * - Leaderboard showing win rates across all comparisons
 * - Export comparison history as JSON
 *
 * Triggered via `/compare` slash command or the panel itself.
 *
 * @namespace ModelComparePanel
 */
const ModelComparePanel = (() => {
  let isOpen = false;
  let panelEl = null;
  let _activeTab = 'compare'; // 'compare' | 'history' | 'leaderboard'

  /** Escape HTML entities. */
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Create and inject the panel element into the DOM. */
  function _createPanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement('div');
    panelEl.id = 'model-compare-panel';
    panelEl.className = 'mc-panel mc-panel-hidden';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Model Compare Panel');
    panelEl.innerHTML = _buildPanelHTML();
    document.body.appendChild(panelEl);
    _bindEvents();
    return panelEl;
  }

  /** Build the full panel HTML. */
  function _buildPanelHTML() {
    const models = (typeof ChatConfig !== 'undefined' && ChatConfig.AVAILABLE_MODELS) ?
      ChatConfig.AVAILABLE_MODELS : [];

    let modelCheckboxes = '';
    // Pre-select first 2 models
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      const checked = i < 2 ? ' checked' : '';
      modelCheckboxes += '<label class="mcp-model-label">' +
        '<input type="checkbox" class="mcp-model-cb" value="' + esc(m.id) + '"' + checked + '>' +
        '<span class="mcp-model-name">' + esc(m.label || m.id) + '</span></label>';
    }

    return '' +
      '<div class="mcp-header">' +
        '<h3>⚔️ Model Compare</h3>' +
        '<div class="mcp-tabs">' +
          '<button class="mcp-tab mcp-tab-active" data-tab="compare">Compare</button>' +
          '<button class="mcp-tab" data-tab="history">History</button>' +
          '<button class="mcp-tab" data-tab="leaderboard">Leaderboard</button>' +
        '</div>' +
        '<button class="mcp-close" aria-label="Close panel">&times;</button>' +
      '</div>' +
      '<div class="mcp-body">' +
        // Compare tab
        '<div class="mcp-section mcp-section-compare">' +
          '<div class="mcp-models-grid">' +
            '<label class="mcp-field-label">Select models (2+):</label>' +
            '<div class="mcp-models-list">' + modelCheckboxes + '</div>' +
          '</div>' +
          '<div class="mcp-prompt-area">' +
            '<label class="mcp-field-label">Prompt:</label>' +
            '<textarea class="mcp-prompt-input" rows="3" placeholder="Enter prompt to compare across models..."></textarea>' +
            '<div class="mcp-prompt-actions">' +
              '<button class="mcp-btn mcp-btn-fill" title="Fill from chat input">📋 Fill from input</button>' +
              '<button class="mcp-btn mcp-btn-run" title="Run comparison">⚔️ Compare</button>' +
            '</div>' +
          '</div>' +
          '<div class="mcp-status"></div>' +
          '<div class="mcp-result"></div>' +
        '</div>' +
        // History tab
        '<div class="mcp-section mcp-section-history" style="display:none">' +
          '<div class="mcp-history-actions">' +
            '<button class="mcp-btn mcp-btn-export">📤 Export JSON</button>' +
            '<button class="mcp-btn mcp-btn-clear-history">🗑️ Clear</button>' +
          '</div>' +
          '<div class="mcp-history-list"></div>' +
        '</div>' +
        // Leaderboard tab
        '<div class="mcp-section mcp-section-leaderboard" style="display:none">' +
          '<div class="mcp-leaderboard-content"></div>' +
        '</div>' +
      '</div>';
  }

  /** Bind all event listeners. */
  function _bindEvents() {
    if (!panelEl) return;

    // Close button
    panelEl.querySelector('.mcp-close').addEventListener('click', close);

    // Tab switching
    panelEl.querySelectorAll('.mcp-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        _switchTab(tab.dataset.tab);
      });
    });

    // Fill from input
    panelEl.querySelector('.mcp-btn-fill').addEventListener('click', function () {
      const chatInput = document.getElementById('user-input');
      if (chatInput && chatInput.value.trim()) {
        panelEl.querySelector('.mcp-prompt-input').value = chatInput.value.trim();
      }
    });

    // Run comparison
    panelEl.querySelector('.mcp-btn-run').addEventListener('click', _runComparison);

    // Export history
    panelEl.querySelector('.mcp-btn-export').addEventListener('click', function () {
      const json = ModelCompare.exportHistory();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model-comparisons-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    // Clear history
    panelEl.querySelector('.mcp-btn-clear-history').addEventListener('click', function () {
      if (confirm('Clear all comparison history?')) {
        ModelCompare.clearHistory();
        _renderHistory();
      }
    });

    // Delegate vote button clicks within results
    panelEl.addEventListener('click', function (e) {
      const btn = e.target.closest('.mc-vote-btn');
      if (!btn) return;
      const modelId = btn.dataset.mcModel;
      const compId = btn.dataset.mcId;
      if (modelId && compId) {
        ModelCompare.setWinner(compId, modelId);
        // Re-render the comparison
        const comp = ModelCompare.getComparison(compId);
        if (comp) {
          const container = btn.closest('.mc-comparison');
          if (container) {
            container.outerHTML = ModelCompare.buildComparisonView(comp);
          }
        }
      }
    });
  }

  /** Switch active tab. */
  function _switchTab(tabName) {
    _activeTab = tabName;
    panelEl.querySelectorAll('.mcp-tab').forEach(function (t) {
      t.classList.toggle('mcp-tab-active', t.dataset.tab === tabName);
    });
    panelEl.querySelectorAll('.mcp-section').forEach(function (s) {
      s.style.display = 'none';
    });
    const section = panelEl.querySelector('.mcp-section-' + tabName);
    if (section) section.style.display = '';

    if (tabName === 'history') _renderHistory();
    if (tabName === 'leaderboard') _renderLeaderboard();
  }

  /** Run a model comparison. */
  async function _runComparison() {
    const prompt = panelEl.querySelector('.mcp-prompt-input').value.trim();
    if (!prompt) {
      _setStatus('Enter a prompt to compare.', 'warn');
      return;
    }

    const checked = panelEl.querySelectorAll('.mcp-model-cb:checked');
    const modelIds = [];
    checked.forEach(function (cb) { modelIds.push(cb.value); });

    if (modelIds.length < 2) {
      _setStatus('Select at least 2 models.', 'warn');
      return;
    }

    _setStatus('⏳ Running comparison across ' + modelIds.length + ' models...', 'info');
    panelEl.querySelector('.mcp-btn-run').disabled = true;
    panelEl.querySelector('.mcp-result').innerHTML = '';

    try {
      const result = await ModelCompare.compare(prompt, modelIds);
      panelEl.querySelector('.mcp-result').innerHTML =
        ModelCompare.buildComparisonView(result);
      _setStatus('✅ Comparison complete (' + result.totalMs + 'ms total)', 'success');
    } catch (err) {
      _setStatus('❌ ' + (err.message || 'Comparison failed'), 'error');
    } finally {
      panelEl.querySelector('.mcp-btn-run').disabled = false;
    }
  }

  /** Set status message. */
  function _setStatus(msg, type) {
    const el = panelEl.querySelector('.mcp-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'mcp-status mcp-status-' + (type || 'info');
  }

  /** Render comparison history list. */
  function _renderHistory() {
    const list = panelEl.querySelector('.mcp-history-list');
    if (!list) return;

    const history = ModelCompare.getHistory(50);
    if (history.length === 0) {
      list.innerHTML = '<div class="mcp-empty">No comparisons yet. Run your first one!</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < history.length; i++) {
      const c = history[i];
      const date = new Date(c.createdAt).toLocaleString();
      const models = c.responses.map(function (r) { return r.modelLabel; }).join(' vs ');
      const winner = c.winner ?
        (c.responses.find(function (r) { return r.modelId === c.winner; }) || {}).modelLabel || c.winner :
        'No winner';

      html += '<div class="mcp-history-item" data-cmp-id="' + esc(c.id) + '">' +
        '<div class="mcp-history-prompt">' + esc(c.prompt.slice(0, 120)) +
          (c.prompt.length > 120 ? '...' : '') + '</div>' +
        '<div class="mcp-history-meta">' +
          '<span>' + esc(models) + '</span>' +
          '<span>Winner: ' + esc(winner) + '</span>' +
          '<span>' + c.totalMs + 'ms</span>' +
          '<span>' + date + '</span>' +
        '</div>' +
      '</div>';
    }
    list.innerHTML = html;

    // Click to expand
    list.querySelectorAll('.mcp-history-item').forEach(function (item) {
      item.addEventListener('click', function () {
        const comp = ModelCompare.getComparison(item.dataset.cmpId);
        if (!comp) return;
        // Show expanded view
        const existing = item.querySelector('.mcp-history-expanded');
        if (existing) {
          existing.remove();
          return;
        }
        const div = document.createElement('div');
        div.className = 'mcp-history-expanded';
        div.innerHTML = ModelCompare.buildComparisonView(comp);
        item.appendChild(div);
      });
    });
  }

  /** Render leaderboard. */
  function _renderLeaderboard() {
    const el = panelEl.querySelector('.mcp-leaderboard-content');
    if (!el) return;

    const stats = ModelCompare.getModelStats();
    const entries = Object.entries(stats);

    if (entries.length === 0) {
      el.innerHTML = '<div class="mcp-empty">No data yet. Compare some models first!</div>';
      return;
    }

    // Sort by win rate descending, then by appearances
    entries.sort(function (a, b) {
      if (b[1].winRate !== a[1].winRate) return b[1].winRate - a[1].winRate;
      return b[1].appearances - a[1].appearances;
    });

    let html = '<table class="mcp-leaderboard-table">' +
      '<thead><tr>' +
        '<th>#</th><th>Model</th><th>Wins</th><th>Matches</th>' +
        '<th>Win Rate</th><th>Avg Latency</th>' +
      '</tr></thead><tbody>';

    for (let i = 0; i < entries.length; i++) {
      const [id, s] = entries[i];
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
      html += '<tr>' +
        '<td>' + medal + (i + 1) + '</td>' +
        '<td>' + esc(s.label) + '</td>' +
        '<td>' + s.wins + '</td>' +
        '<td>' + s.appearances + '</td>' +
        '<td>' + (s.winRate * 100).toFixed(1) + '%</td>' +
        '<td>' + s.avgLatencyMs + 'ms</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  /** Open the panel. */
  function open() {
    _createPanel();
    panelEl.classList.remove('mc-panel-hidden');
    isOpen = true;
    _switchTab('compare');
  }

  /** Close the panel. */
  function close() {
    if (panelEl) panelEl.classList.add('mc-panel-hidden');
    isOpen = false;
  }

  /** Toggle the panel. */
  function toggle() {
    isOpen ? close() : open();
  }

  return {
    open: open,
    close: close,
    toggle: toggle
  };
})();

/* ---------- Message Editor ---------- */
/**
 * Edit & resend user messages.
 *
 * Adds a pencil button (✏️) on each user message in the history panel.
 * When clicked:
 *   1. The conversation is truncated to remove that message and everything
 *      after it (rewinding the timeline).
 *   2. The message text is placed into the chat input so the user can
 *      modify it and re-send.
 *   3. The history panel refreshes to reflect the shorter conversation.
 *
 * This mirrors the "Edit message" UX in ChatGPT / Claude — a frequently
 * requested pattern for iterating on prompts without starting over.
 *
 * Hooks into HistoryPanel's single-pass _decorateAllMessages via
 * decorateOne(msgEl, historyIndex).
 *
 * Storage key: agenticchat_edit_history (last 50 edits for undo).
 *
 * @namespace MessageEditor
 */
const MessageEditor = (() => {
  const STORE_KEY = 'agenticchat_edit_history';
  const MAX_EDITS = 50;

  // Uses the shared _escapeHtml defined at file scope.

  /* ── Persistence ──────────────────────────────────────────── */

  /** Load edit history from storage. */
  function _loadEdits() {
    try {
      const raw = SafeStorage.get(STORE_KEY);
      return raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch (_) { return []; }
  }

  /** Save edit history to storage. */
  function _saveEdits(edits) {
    try {
      SafeStorage.set(STORE_KEY, JSON.stringify(edits.slice(-MAX_EDITS)));
    } catch (_) { /* quota */ }
  }

  /** Record an edit action (original text + index). */
  function _recordEdit(historyIndex, originalText) {
    const edits = _loadEdits();
    edits.push({
      historyIndex,
      originalText,
      timestamp: Date.now()
    });
    _saveEdits(edits);
  }

  /* ── Core logic ───────────────────────────────────────────── */

  /**
   * Edit a user message at the given history index.
   *
   * Truncates the conversation so that the edited message and all
   * subsequent messages are removed, then places the original text
   * in the chat input for modification.
   *
   * @param {number} historyIndex — index in ConversationManager.getHistory()
   *   (includes system message at index 0)
   */
  function editAt(historyIndex) {
    const history = ConversationManager.getHistory();
    if (historyIndex < 1 || historyIndex >= history.length) return;

    const msg = history[historyIndex];
    if (msg.role !== 'user') return;

    const originalText = msg.content;

    // Confirm if there are assistant replies that will be lost
    const messagesAfter = history.length - historyIndex - 1;
    if (messagesAfter > 0) {
      const ok = confirm(
        `Editing this message will remove ${messagesAfter} message${messagesAfter !== 1 ? 's' : ''} ` +
        'after it (including assistant replies).\n\nContinue?'
      );
      if (!ok) return;
    }

    // Record for undo history
    _recordEdit(historyIndex, originalText);

    // Truncate conversation at this message
    ConversationManager.truncateAt(historyIndex);

    // Place original text in input
    UIController.setChatInput(originalText);

    // Update the main chat display
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(editing message — modify and re-send)');
    UIController.setLastPrompt('✏️ Editing previous message');

    // Refresh history panel
    HistoryPanel.refresh();

    // Auto-save the truncated session
    SessionManager.autoSaveIfEnabled();

    // Show notification
    _showEditNotification();
  }

  /* ── UI / decoration ──────────────────────────────────────── */

  /**
   * Add an edit button to a single user-message element.
   * Called by HistoryPanel._decorateAllMessages for each message.
   *
   * @param {HTMLElement} msgEl — the .history-msg element
   * @param {number} historyIndex — index in ConversationManager.getHistory()
   */
  function decorateOne(msgEl, historyIndex) {
    // Only decorate user messages
    const history = ConversationManager.getHistory();
    if (historyIndex < 1 || historyIndex >= history.length) return;
    if (history[historyIndex].role !== 'user') return;

    // Don't add if already present
    if (msgEl.querySelector('.msg-edit-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'msg-edit-btn';
    btn.textContent = '✏️ Edit';
    btn.title = 'Edit this message — truncates conversation and loads text into input for re-sending';
    btn.setAttribute('aria-label', 'Edit and resend this message');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editAt(historyIndex);
      HistoryPanel.close();
    });

    msgEl.appendChild(btn);
  }

  /**
   * Bulk-decorate all messages in a container.
   * Kept for backward compatibility; the single-pass decorator
   * in HistoryPanel uses decorateOne directly.
   */
  function decorateMessages() {
    const container = document.getElementById('history-messages');
    if (!container) return;

    const msgs = container.querySelectorAll('.history-msg');
    const history = ConversationManager.getHistory();

    let nonSystemIdx = 0;
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'system') continue;
      if (nonSystemIdx < msgs.length) {
        decorateOne(msgs[nonSystemIdx], i);
      }
      nonSystemIdx++;
    }
  }

  /**
   * Show a temporary notification when a message is loaded for editing.
   */
  function _showEditNotification() {
    const note = document.createElement('div');
    note.className = 'msg-edit-notification';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.innerHTML =
      '<span class="msg-edit-notification-icon">✏️</span> ' +
      '<span>Message loaded for editing — modify and press Send</span>';
    document.body.appendChild(note);

    requestAnimationFrame(() => note.classList.add('visible'));

    setTimeout(() => {
      note.classList.remove('visible');
      setTimeout(() => note.remove(), 300);
    }, 3000);
  }

  /* ── Edit history access ──────────────────────────────────── */

  /** Get the list of recorded edits (most recent last). */
  function getEditHistory() { return _loadEdits(); }

  /** Clear stored edit history. */
  function clearEditHistory() {
    try { SafeStorage.remove(STORE_KEY); } catch (_) { /* ok */ }
  }

  return {
    editAt,
    decorateOne,
    decorateMessages,
    getEditHistory,
    clearEditHistory
  };
})();


// ═══════════════════════════════════════════════════════════════════════
//  MessageScheduler — schedule prompts to send at a specific time
// ═══════════════════════════════════════════════════════════════════════

const MessageScheduler = (() => {
  'use strict';

  const STORE_KEY = 'agentichat_scheduled_msgs';
  const CHECK_INTERVAL = 15000; // check every 15 seconds
  let _checkTimer = null;
  let _panelEl = null;
  let _onSendCallback = null;

  /* ── Persistence ────────────────────────────────────────── */

  function _load() {
    try {
      const raw = SafeStorage.get(STORE_KEY);
      if (!raw) return [];
      const arr = sanitizeStorageObject(JSON.parse(raw));
      if (!Array.isArray(arr)) return [];
      return arr.filter(m =>
        m && typeof m.id === 'string' &&
        typeof m.text === 'string' &&
        typeof m.scheduledAt === 'number'
      );
    } catch (_) { return []; }
  }

  function _save(items) {
    try { SafeStorage.set(STORE_KEY, JSON.stringify(items)); } catch (_) {}
  }

  /* ── Core ────────────────────────────────────────────────── */

  function schedule(text, dateTime, label) {
    if (!text || !text.trim()) return null;
    const ts = dateTime instanceof Date ? dateTime.getTime() : Number(dateTime);
    if (isNaN(ts) || ts < Date.now()) return null;

    const item = {
      id: 'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      text: text.trim(),
      scheduledAt: ts,
      label: (label || '').trim() || null,
      createdAt: Date.now(),
      status: 'pending' // pending | sent | cancelled
    };

    const items = _load();
    items.push(item);
    _save(items);
    _renderPanel();
    return item;
  }

  function cancel(id) {
    const items = _load();
    const idx = items.findIndex(m => m.id === id);
    if (idx === -1) return false;
    items[idx].status = 'cancelled';
    _save(items);
    _renderPanel();
    return true;
  }

  function remove(id) {
    let items = _load();
    items = items.filter(m => m.id !== id);
    _save(items);
    _renderPanel();
  }

  function getAll() { return _load(); }

  function getPending() {
    return _load().filter(m => m.status === 'pending');
  }

  function getHistory() {
    return _load().filter(m => m.status !== 'pending');
  }

  function clearHistory() {
    const items = _load().filter(m => m.status === 'pending');
    _save(items);
    _renderPanel();
  }

  /* ── Timer loop ──────────────────────────────────────────── */

  function _checkScheduled() {
    const items = _load();
    const now = Date.now();
    let changed = false;

    for (let i = 0; i < items.length; i++) {
      if (items[i].status === 'pending' && items[i].scheduledAt <= now) {
        items[i].status = 'sent';
        items[i].sentAt = now;
        changed = true;
        _dispatch(items[i]);
      }
    }

    if (changed) {
      _save(items);
      _renderPanel();
    }
  }

  function _dispatch(item) {
    if (_onSendCallback) {
      _onSendCallback(item.text);
    } else {
      // Fallback: inject into chat input and submit
      const input = document.getElementById('messageInput');
      if (input) {
        input.value = item.text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        } else {
          const sendBtn = document.querySelector('.send-button, #sendButton, [data-send]');
          if (sendBtn) sendBtn.click();
        }
      }
    }
  }

  function onSend(callback) {
    _onSendCallback = typeof callback === 'function' ? callback : null;
  }

  /* ── Panel UI ────────────────────────────────────────────── */

  function _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function _fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return 'Today ' + time;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }

  function _fmtRelative(ts) {
    const diff = ts - Date.now();
    if (diff <= 0) return 'now';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return 'in ' + mins + 'm';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return 'in ' + hrs + 'h';
    return 'in ' + Math.round(hrs / 24) + 'd';
  }

  function _createPanel() {
    if (_panelEl) return _panelEl;

    const panel = document.createElement('div');
    panel.id = 'schedulerPanel';
    panel.className = 'scheduler-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Scheduled Messages');
    panel.innerHTML =
      '<div class="scheduler-header">' +
        '<h3>⏰ Scheduled Messages</h3>' +
        '<button class="scheduler-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="scheduler-body">' +
        '<div class="scheduler-form">' +
          '<textarea id="schedMsgInput" class="scheduler-textarea" placeholder="Type your message..." rows="2" maxlength="2000"></textarea>' +
          '<div class="scheduler-time-row">' +
            '<label for="schedDatetime">Send at:</label>' +
            '<input type="datetime-local" id="schedDatetime" class="scheduler-datetime">' +
            '<div class="scheduler-quick-btns">' +
              '<button class="scheduler-quick" data-mins="15">15m</button>' +
              '<button class="scheduler-quick" data-mins="30">30m</button>' +
              '<button class="scheduler-quick" data-mins="60">1h</button>' +
              '<button class="scheduler-quick" data-mins="180">3h</button>' +
            '</div>' +
          '</div>' +
          '<input type="text" id="schedLabel" class="scheduler-label-input" placeholder="Label (optional)" maxlength="50">' +
          '<button id="schedSubmit" class="scheduler-submit">Schedule Message</button>' +
        '</div>' +
        '<div class="scheduler-list" id="schedulerList"></div>' +
        '<div class="scheduler-history-toggle">' +
          '<button id="schedHistoryToggle" class="scheduler-history-btn">Show History</button>' +
          '<button id="schedClearHistory" class="scheduler-clear-btn" style="display:none">Clear History</button>' +
        '</div>' +
        '<div class="scheduler-history" id="schedulerHistory" style="display:none"></div>' +
      '</div>';

    document.body.appendChild(panel);
    _panelEl = panel;

    // Event listeners
    panel.querySelector('.scheduler-close').addEventListener('click', togglePanel);

    panel.querySelector('#schedSubmit').addEventListener('click', _handleSubmit);

    panel.querySelector('#schedMsgInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        _handleSubmit();
      }
    });

    const quickBtns = panel.querySelectorAll('.scheduler-quick');
    for (let i = 0; i < quickBtns.length; i++) {
      quickBtns[i].addEventListener('click', function () {
        const mins = parseInt(this.getAttribute('data-mins'), 10);
        const dt = new Date(Date.now() + mins * 60000);
        const dtInput = panel.querySelector('#schedDatetime');
        // Format for datetime-local: YYYY-MM-DDTHH:MM
        const pad = (n) => String(n).padStart(2, '0');
        dtInput.value = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' +
          pad(dt.getDate()) + 'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
      });
    }

    const histToggle = panel.querySelector('#schedHistoryToggle');
    const histEl = panel.querySelector('#schedulerHistory');
    const clearBtn = panel.querySelector('#schedClearHistory');
    histToggle.addEventListener('click', () => {
      const showing = histEl.style.display !== 'none';
      histEl.style.display = showing ? 'none' : 'block';
      clearBtn.style.display = showing ? 'none' : 'inline-block';
      histToggle.textContent = showing ? 'Show History' : 'Hide History';
      if (!showing) _renderHistory();
    });
    clearBtn.addEventListener('click', () => {
      clearHistory();
      _renderHistory();
    });

    // Delegate clicks on cancel/remove buttons
    panel.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('[data-sched-cancel]');
      if (cancelBtn) { cancel(cancelBtn.getAttribute('data-sched-cancel')); return; }
      const removeBtn = e.target.closest('[data-sched-remove]');
      if (removeBtn) { remove(removeBtn.getAttribute('data-sched-remove')); return; }
    });

    return panel;
  }

  function _handleSubmit() {
    const msgInput = document.getElementById('schedMsgInput');
    const dtInput = document.getElementById('schedDatetime');
    const labelInput = document.getElementById('schedLabel');
    if (!msgInput || !dtInput) return;

    const text = msgInput.value.trim();
    if (!text) { msgInput.focus(); return; }

    const dtVal = dtInput.value;
    if (!dtVal) { dtInput.focus(); return; }

    const dateTime = new Date(dtVal);
    if (isNaN(dateTime.getTime()) || dateTime.getTime() <= Date.now()) {
      dtInput.setCustomValidity('Please pick a future time');
      dtInput.reportValidity();
      setTimeout(() => dtInput.setCustomValidity(''), 2000);
      return;
    }

    const label = labelInput ? labelInput.value.trim() : '';
    const item = schedule(text, dateTime, label);
    if (item) {
      msgInput.value = '';
      dtInput.value = '';
      if (labelInput) labelInput.value = '';
      _showToast('Message scheduled for ' + _fmtTime(item.scheduledAt));
    }
  }

  function _renderPanel() {
    const listEl = document.getElementById('schedulerList');
    if (!listEl) return;

    const pending = getPending().sort((a, b) => a.scheduledAt - b.scheduledAt);
    if (pending.length === 0) {
      listEl.innerHTML = '<div class="scheduler-empty">No scheduled messages</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < pending.length; i++) {
      const m = pending[i];
      html +=
        '<div class="scheduler-item">' +
          '<div class="scheduler-item-time">' +
            '<span class="scheduler-item-when">' + _fmtTime(m.scheduledAt) + '</span>' +
            '<span class="scheduler-item-relative">' + _fmtRelative(m.scheduledAt) + '</span>' +
          '</div>' +
          (m.label ? '<div class="scheduler-item-label">' + _esc(m.label) + '</div>' : '') +
          '<div class="scheduler-item-text">' + _esc(m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text) + '</div>' +
          '<button class="scheduler-cancel-btn" data-sched-cancel="' + m.id + '" title="Cancel">✕</button>' +
        '</div>';
    }
    listEl.innerHTML = html;
  }

  function _renderHistory() {
    const histEl = document.getElementById('schedulerHistory');
    if (!histEl) return;

    const hist = getHistory().sort((a, b) => (b.sentAt || b.scheduledAt) - (a.sentAt || a.scheduledAt));
    if (hist.length === 0) {
      histEl.innerHTML = '<div class="scheduler-empty">No history yet</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < hist.length; i++) {
      const m = hist[i];
      const statusCls = m.status === 'sent' ? 'scheduler-status-sent' : 'scheduler-status-cancelled';
      const statusLabel = m.status === 'sent' ? '✓ Sent' : '✕ Cancelled';
      html +=
        '<div class="scheduler-item scheduler-item-history">' +
          '<div class="scheduler-item-time">' +
            '<span class="scheduler-item-when">' + _fmtTime(m.scheduledAt) + '</span>' +
            '<span class="' + statusCls + '">' + statusLabel + '</span>' +
          '</div>' +
          (m.label ? '<div class="scheduler-item-label">' + _esc(m.label) + '</div>' : '') +
          '<div class="scheduler-item-text">' + _esc(m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text) + '</div>' +
          '<button class="scheduler-remove-btn" data-sched-remove="' + m.id + '" title="Remove">🗑</button>' +
        '</div>';
    }
    histEl.innerHTML = html;
  }

  function _showToast(msg) {
    const existing = document.querySelector('.scheduler-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'scheduler-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('scheduler-toast-visible'); }, 10);
    setTimeout(() => {
      toast.classList.remove('scheduler-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ── Toggle ──────────────────────────────────────────────── */

  function togglePanel() {
    const panel = _createPanel();
    const visible = panel.classList.contains('scheduler-panel-visible');
    panel.classList.toggle('scheduler-panel-visible', !visible);
    if (!visible) {
      _renderPanel();
      // Set default datetime to +30 min
      const dtInput = panel.querySelector('#schedDatetime');
      if (dtInput && !dtInput.value) {
        const def = new Date(Date.now() + 30 * 60000);
        const pad = (n) => String(n).padStart(2, '0');
        dtInput.value = def.getFullYear() + '-' + pad(def.getMonth() + 1) + '-' +
          pad(def.getDate()) + 'T' + pad(def.getHours()) + ':' + pad(def.getMinutes());
      }
    }
  }

  /* ── Init ────────────────────────────────────────────────── */

  function init() {
    // Start the check loop
    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer = setInterval(_checkScheduled, CHECK_INTERVAL);

    // Add toolbar button
    const toolbar = document.querySelector('.toolbar, .chat-toolbar, .sidebar');
    if (toolbar) {
      const btn = document.createElement('button');
      btn.className = 'scheduler-toggle-btn';
      btn.setAttribute('aria-label', 'Scheduled Messages');
      btn.setAttribute('title', 'Scheduled Messages');
      btn.textContent = '⏰';

      const pending = getPending();
      if (pending.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'scheduler-badge';
        badge.textContent = pending.length;
        btn.appendChild(badge);
      }

      btn.addEventListener('click', togglePanel);
      toolbar.appendChild(btn);
    }

    // Register slash command if SlashCommands available
    if (typeof SlashCommands !== 'undefined' && SlashCommands.register) {
      SlashCommands.register({
        name: 'schedule',
        description: 'Schedule a message: /schedule 30m Your message here',
        handler: function (args) {
          const match = args.match(/^(\d+)\s*(m|min|h|hr|hour|d|day)\s+(.+)/i);
          if (!match) return 'Usage: /schedule 30m Your prompt here';
          const amount = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          let ms = amount * 60000; // default minutes
          if (unit.startsWith('h')) ms = amount * 3600000;
          if (unit.startsWith('d')) ms = amount * 86400000;
          const dt = new Date(Date.now() + ms);
          const item = schedule(match[3], dt);
          if (!item) return 'Could not schedule — check the time.';
          return 'Scheduled for ' + _fmtTime(item.scheduledAt) + ': ' + match[3].slice(0, 50);
        }
      });
    }

    // Register keyboard shortcut (Ctrl+Shift+P for scheduler Panel)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  return {
    init,
    schedule,
    cancel,
    remove,
    getAll,
    getPending,
    getHistory,
    clearHistory,
    togglePanel,
    onSend
  };
})();

/* ---------- Smart Retry ---------- */
/**
 * SmartRetry — Automatic retry with exponential backoff for transient API failures.
 *
 * Intercepts 429 (rate limit), 500, 502, 503, and network errors. Shows a
 * visual countdown indicator in the chat output area with a cancel button.
 * Retries up to {@link MAX_RETRIES} times with exponential delays (1s, 2s, 4s).
 *
 * Usage:
 *   const result = await SmartRetry.withRetry(() => callOpenAI(key, msgs));
 *   // result is the first successful response, or the final failure after all retries
 *
 * The retry indicator shows: attempt number, countdown timer, and a cancel button.
 * Cancelled retries return the original error immediately.
 *
 * @namespace SmartRetry
 */
const SmartRetry = (() => {
  const STORAGE_KEY = 'agenticchat_smart_retry';
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

  let _enabled = true;
  let _cancelled = false;
  let _retryStats = { totalRetries: 0, successfulRetries: 0, failedRetries: 0 };
  let _countdownInterval = null;

  /** Load persisted settings. */
  function _loadSettings() {
    const raw = SafeStorage.get(STORAGE_KEY);
    if (raw) {
      try {
        const data = sanitizeStorageObject(JSON.parse(raw));
        _enabled = data.enabled !== false;
        if (data.stats) _retryStats = data.stats;
      } catch (_) {}
    }
  }

  /** Save settings to localStorage. */
  function _save() {
    SafeStorage.set(STORAGE_KEY, JSON.stringify({
      enabled: _enabled,
      stats: _retryStats
    }));
  }

  /** Check if a result should be retried. */
  function isRetryable(result) {
    if (!result) return false;
    if (result.networkError) return true;
    return !!(result.status && RETRYABLE_STATUSES.has(result.status));
  }

  /** Calculate delay for attempt n (0-indexed): base * 2^n + jitter. */
  function getDelay(attempt) {
    const base = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 300);
    return base + jitter;
  }

  /** Show retry indicator in chat output. */
  function _showRetryIndicator(attempt, delayMs, error) {
    const container = document.getElementById('chat-output');
    if (!container) return;

    let remaining = Math.ceil(delayMs / 1000);
    const retryDiv = document.createElement('div');
    retryDiv.className = 'smart-retry-indicator';
    retryDiv.id = 'smart-retry-indicator';

    const statusText = error || 'Request failed';
    retryDiv.innerHTML =
      '<div class="retry-header">' +
        '<span class="retry-icon">\u27F3</span> ' +
        '<strong>Retrying</strong> (attempt ' + (attempt + 1) + '/' + MAX_RETRIES + ')' +
      '</div>' +
      '<div class="retry-reason">' + _escapeHtml(statusText) + '</div>' +
      '<div class="retry-countdown">Retrying in <span id="retry-seconds">' + remaining + '</span>s\u2026</div>' +
      '<button class="retry-cancel-btn" id="retry-cancel-btn">Cancel</button>';

    const existing = document.getElementById('smart-retry-indicator');
    if (existing) existing.remove();

    container.appendChild(retryDiv);

    const cancelBtn = document.getElementById('retry-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        _cancelled = true;
        _clearIndicator();
      });
    }

    if (_countdownInterval) clearInterval(_countdownInterval);
    _countdownInterval = setInterval(() => {
      remaining--;
      const el = document.getElementById('retry-seconds');
      if (el) el.textContent = String(remaining);
      if (remaining <= 0) {
        clearInterval(_countdownInterval);
        _countdownInterval = null;
      }
    }, 1000);
  }

  /** Remove retry indicator. */
  function _clearIndicator() {
    if (_countdownInterval) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
    }
    const el = document.getElementById('smart-retry-indicator');
    if (el) el.remove();
  }

  /** Escape HTML for safe display. */
  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Wrap an async API call with automatic retry logic.
   *
   * @param {Function} fn — Async function returning {ok, status?, error?, networkError?}
   * @param {Object} [opts] — Options
   * @param {number} [opts.maxRetries] — Override max retries (default 3)
   * @param {boolean} [opts.showIndicator] — Show visual retry indicator (default true)
   * @returns {Promise<Object>} The API result (success or final failure)
   */
  async function withRetry(fn, opts) {
    if (!_enabled) return fn();

    const maxRetries = (opts && opts.maxRetries) || MAX_RETRIES;
    const showIndicator = !(opts && opts.showIndicator === false);
    _cancelled = false;

    let lastResult = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();

        if (result && result.ok) {
          if (attempt > 0) {
            _retryStats.successfulRetries++;
            _save();
            _clearIndicator();
          }
          return result;
        }

        lastResult = result;

        if (attempt < maxRetries && isRetryable(result)) {
          _retryStats.totalRetries++;
          const delay = getDelay(attempt);

          if (showIndicator) {
            _showRetryIndicator(attempt, delay, result.error);
          }

          await new Promise((resolve) => {
            const timer = setTimeout(resolve, delay);
            const checkCancel = setInterval(() => {
              if (_cancelled) {
                clearTimeout(timer);
                clearInterval(checkCancel);
                resolve();
              }
            }, 100);
            setTimeout(() => clearInterval(checkCancel), delay + 100);
          });

          if (_cancelled) {
            _clearIndicator();
            _retryStats.failedRetries++;
            _save();
            return lastResult;
          }

          _clearIndicator();
          continue;
        }

        if (attempt > 0) {
          _retryStats.failedRetries++;
          _save();
        }
        return result;

      } catch (err) {
        lastResult = {
          ok: false,
          error: 'Network error: ' + err.message,
          networkError: true
        };

        if (attempt < maxRetries) {
          _retryStats.totalRetries++;
          const delay = getDelay(attempt);

          if (showIndicator) {
            _showRetryIndicator(attempt, delay, lastResult.error);
          }

          await new Promise((resolve) => {
            const timer = setTimeout(resolve, delay);
            const checkCancel = setInterval(() => {
              if (_cancelled) {
                clearTimeout(timer);
                clearInterval(checkCancel);
                resolve();
              }
            }, 100);
            setTimeout(() => clearInterval(checkCancel), delay + 100);
          });

          if (_cancelled) {
            _clearIndicator();
            _retryStats.failedRetries++;
            _save();
            return lastResult;
          }

          _clearIndicator();
          continue;
        }

        _retryStats.failedRetries++;
        _save();
        return lastResult;
      }
    }

    return lastResult;
  }

  /** Toggle retry on/off. */
  function setEnabled(val) {
    _enabled = !!val;
    _save();
  }

  function isEnabled() { return _enabled; }

  function getStats() { return Object.assign({}, _retryStats); }

  function resetStats() {
    _retryStats = { totalRetries: 0, successfulRetries: 0, failedRetries: 0 };
    _save();
  }

  function cancel() {
    _cancelled = true;
    _clearIndicator();
  }

  function init() { _loadSettings(); }

  return {
    withRetry,
    isRetryable,
    getDelay,
    setEnabled,
    isEnabled,
    getStats,
    resetStats,
    cancel,
    init,
    MAX_RETRIES,
    RETRYABLE_STATUSES,
    _showRetryIndicator,
    _clearIndicator
  };
})();

/* ---------- Usage Heatmap ---------- */
/**
 * GitHub-style 7x24 activity heatmap showing chat patterns across
 * all saved sessions.  Scans message timestamps and renders a
 * day-of-week x hour-of-day grid with color intensity proportional
 * to message count.
 *
 * Public API:
 *   toggle()           - open / close heatmap panel
 *   open()             - render and show
 *   close()            - hide panel
 *   getData()          - raw 7x24 matrix of counts
 *   getTotalMessages() - total messages scanned
 *   getPeakHour()      - {day, hour, count} of busiest slot
 *   getActiveHours()   - number of day x hour slots with >= 1 message
 *   exportCSV()        - download heatmap data as CSV
 *
 * @namespace UsageHeatmap
 */
const UsageHeatmap = (() => {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
    'Thursday', 'Friday', 'Saturday'];

  let isOpen = false;

  /* -- Data collection ------------------------------------------------- */

  /**
   * Scan all saved sessions and the current conversation to build
   * a 7x24 matrix of message counts.
   * @returns {{grid: number[][], total: number, sessionCount: number}}
   */
  function _collectData() {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let total = 0;
    let sessionCount = 0;

    if (typeof SessionManager !== 'undefined' && SessionManager.getAll) {
      const sessions = SessionManager.getAll();
      sessionCount = sessions.length;
      for (const session of sessions) {
        const msgs = session.messages || session.history || [];
        for (const msg of msgs) {
          const ts = msg.timestamp || msg.createdAt || msg.time;
          if (!ts) continue;
          const d = new Date(ts);
          if (isNaN(d.getTime())) continue;
          grid[d.getDay()][d.getHours()]++;
          total++;
        }
      }
    }

    if (typeof ConversationManager !== 'undefined' && ConversationManager.getHistory) {
      const current = ConversationManager.getHistory();
      for (const msg of current) {
        const ts = msg.timestamp || msg.createdAt || msg.time;
        if (!ts) continue;
        const d = new Date(ts);
        if (isNaN(d.getTime())) continue;
        grid[d.getDay()][d.getHours()]++;
        total++;
      }
    }

    return { grid, total, sessionCount };
  }

  function getData() {
    return _collectData().grid;
  }

  function getTotalMessages() {
    return _collectData().total;
  }

  /**
   * Find the peak (busiest) day x hour slot.
   * @returns {{day: number, dayName: string, hour: number, count: number}|null}
   */
  function getPeakHour() {
    const { grid } = _collectData();
    let maxCount = 0;
    let peakDay = 0;
    let peakHour = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (grid[d][h] > maxCount) {
          maxCount = grid[d][h];
          peakDay = d;
          peakHour = h;
        }
      }
    }
    if (maxCount === 0) return null;
    return {
      day: peakDay,
      dayName: FULL_DAY_NAMES[peakDay],
      hour: peakHour,
      count: maxCount
    };
  }

  function getActiveHours() {
    const { grid } = _collectData();
    let count = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (grid[d][h] > 0) count++;
      }
    }
    return count;
  }

  /* -- Color mapping --------------------------------------------------- */

  function _intensityClass(count, maxCount) {
    if (count === 0) return 'heatmap-level-0';
    if (maxCount === 0) return 'heatmap-level-0';
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 'heatmap-level-1';
    if (ratio <= 0.50) return 'heatmap-level-2';
    if (ratio <= 0.75) return 'heatmap-level-3';
    return 'heatmap-level-4';
  }

  function _fmtHour(h) {
    if (h === 0) return '12a';
    if (h < 12) return h + 'a';
    if (h === 12) return '12p';
    return (h - 12) + 'p';
  }

  /* -- Rendering ------------------------------------------------------- */

  function _render() {
    const container = document.getElementById('heatmap-grid');
    const statsEl = document.getElementById('heatmap-stats');
    if (!container) return;

    const { grid, total, sessionCount } = _collectData();

    let maxCount = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (grid[d][h] > maxCount) maxCount = grid[d][h];
      }
    }

    let html = '<div class="heatmap-row heatmap-header-row">';
    html += '<div class="heatmap-label"></div>';
    for (let h = 0; h < 24; h++) {
      const show = h % 3 === 0;
      html += '<div class="heatmap-hour-label">' + (show ? _fmtHour(h) : '') + '</div>';
    }
    html += '</div>';

    for (let d = 0; d < 7; d++) {
      html += '<div class="heatmap-row">';
      html += '<div class="heatmap-label">' + DAY_NAMES[d] + '</div>';
      for (let h = 0; h < 24; h++) {
        const count = grid[d][h];
        const cls = _intensityClass(count, maxCount);
        const tip = FULL_DAY_NAMES[d] + ' ' + _fmtHour(h) + ': ' + count +
          ' message' + (count !== 1 ? 's' : '');
        html += '<div class="heatmap-cell ' + cls +
          '" title="' + tip + '" data-count="' + count + '"></div>';
      }
      html += '</div>';
    }

    html += '<div class="heatmap-legend">';
    html += '<span class="heatmap-legend-label">Less</span>';
    for (let i = 0; i <= 4; i++) {
      html += '<div class="heatmap-cell heatmap-legend-cell heatmap-level-' + i + '"></div>';
    }
    html += '<span class="heatmap-legend-label">More</span>';
    html += '</div>';

    container.innerHTML = html;

    if (statsEl) {
      const peak = getPeakHour();
      const active = getActiveHours();
      let s = '<div class="heatmap-stat">';
      s += '<span class="heatmap-stat-value">' + total.toLocaleString() + '</span>';
      s += '<span class="heatmap-stat-label">messages</span></div>';
      s += '<div class="heatmap-stat">';
      s += '<span class="heatmap-stat-value">' + sessionCount + '</span>';
      s += '<span class="heatmap-stat-label">sessions scanned</span></div>';
      s += '<div class="heatmap-stat">';
      s += '<span class="heatmap-stat-value">' + active + '/168</span>';
      s += '<span class="heatmap-stat-label">active hours</span></div>';
      if (peak) {
        s += '<div class="heatmap-stat">';
        s += '<span class="heatmap-stat-value">' + peak.dayName + ' ' +
          _fmtHour(peak.hour) + '</span>';
        s += '<span class="heatmap-stat-label">peak (' + peak.count + ' msgs)</span></div>';
      }
      statsEl.innerHTML = s;
    }
  }

  /* -- Panel management ------------------------------------------------ */

  function open() {
    const panel = document.getElementById('heatmap-panel');
    const overlay = document.getElementById('heatmap-overlay');
    if (panel) panel.style.display = '';
    if (overlay) overlay.style.display = '';
    isOpen = true;
    _render();
  }

  function close() {
    const panel = document.getElementById('heatmap-panel');
    const overlay = document.getElementById('heatmap-overlay');
    if (panel) panel.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    isOpen = false;
  }

  function toggle() {
    isOpen ? close() : open();
  }

  /* -- CSV export ------------------------------------------------------ */

  function exportCSV() {
    const { grid } = _collectData();
    let csv = 'Day,' +
      Array.from({ length: 24 }, (_, h) => _fmtHour(h)).join(',') + '\n';
    for (let d = 0; d < 7; d++) {
      csv += DAY_NAMES[d] + ',' + grid[d].join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'usage-heatmap.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* -- Init ------------------------------------------------------------ */

  function init() {
    const closeBtn = document.getElementById('heatmap-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    const overlay = document.getElementById('heatmap-overlay');
    if (overlay) overlay.addEventListener('click', close);

    const exportBtn = document.getElementById('heatmap-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);

    const refreshBtn = document.getElementById('heatmap-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', _render);
  }

  return {
    toggle,
    open,
    close,
    getData,
    getTotalMessages,
    getPeakHour,
    getActiveHours,
    exportCSV,
    init,
    _collectData,
    _intensityClass,
    _fmtHour,
    _render
  };
})();

document.addEventListener('DOMContentLoaded', UsageHeatmap.init);


// ═══════════════════════════════════════════════════════════════════
//  Context Window Meter
// ═══════════════════════════════════════════════════════════════════
/**
 * ContextWindowMeter — real-time visual indicator of context window usage.
 *
 * Shows a persistent progress bar between the char-count and chat output
 * areas, displaying how much of the model's MAX_TOTAL_TOKENS budget the
 * current conversation consumes.  Color-coded:
 *   green  (<60%)  — plenty of room
 *   yellow (60-80%) — getting full
 *   red    (>80%)  — near limit, messages will be trimmed soon
 *
 * The meter hooks into ConversationManager.estimateTokens() and updates
 * automatically on every UI refresh cycle via a MutationObserver on the
 * chat output container.  It also exposes a manual refresh() for modules
 * that modify history programmatically (e.g. ConversationMerge, clear).
 *
 * @namespace ContextWindowMeter
 */
const ContextWindowMeter = (() => {
  'use strict';

  // ── Thresholds ──────────────────────────────────────────────────
  const YELLOW_THRESHOLD = 0.60;
  const RED_THRESHOLD    = 0.80;

  // ── DOM refs (lazily resolved) ──────────────────────────────────
  let _container = null;
  let _fill      = null;
  let _label     = null;
  let _observer  = null;
  let _visible   = true;

  function _el(id) { return document.getElementById(id); }

  function _ensureEls() {
    if (!_container) _container = _el('context-meter');
    if (!_fill)      _fill      = _el('context-meter-fill');
    if (!_label)     _label     = _el('context-meter-label');
  }

  // ── Color class helper ──────────────────────────────────────────
  function _colorClass(ratio) {
    if (ratio >= RED_THRESHOLD)    return 'context-meter__fill--red';
    if (ratio >= YELLOW_THRESHOLD) return 'context-meter__fill--yellow';
    return 'context-meter__fill--green';
  }

  // ── Format helpers ──────────────────────────────────────────────
  function _fmtK(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  // ── Core update ─────────────────────────────────────────────────
  function refresh() {
    _ensureEls();
    if (!_container || !_fill || !_label) return;

    if (typeof ConversationManager === 'undefined') return;

    const used = ConversationManager.estimateTokens();
    const max  = ChatConfig.MAX_TOTAL_TOKENS;
    const ratio = Math.min(used / max, 1);
    const pct   = Math.round(ratio * 100);

    // Update progress bar
    _fill.style.width = pct + '%';

    // Update color
    _fill.className = 'context-meter__fill ' + _colorClass(ratio);

    // Update label
    _label.textContent = _fmtK(used) + ' / ' + _fmtK(max) + ' tokens (' + pct + '%)';

    // Update ARIA
    _container.setAttribute('aria-valuenow', String(pct));

    // Show/hide: hide when conversation is empty (just system prompt)
    const msgs = ConversationManager.getMessages();
    const hasContent = msgs.length > 1;  // more than just system prompt
    if (hasContent && !_visible) {
      _container.classList.remove('context-meter--hidden');
      _visible = true;
    } else if (!hasContent && _visible) {
      _container.classList.add('context-meter--hidden');
      _visible = false;
    }
  }

  // ── Visibility toggle ──────────────────────────────────────────
  function toggle() {
    _ensureEls();
    if (!_container) return _visible;
    _visible = !_visible;
    _container.style.display = _visible ? '' : 'none';
    try { SafeStorage.set('ac-context-meter-visible', JSON.stringify(_visible)); } catch (_) {}
    return _visible;
  }

  // ── Observer: watch chat output for changes ─────────────────────
  function _startObserver() {
    const chatOutput = _el('output');
    if (!chatOutput) return;

    _observer = new MutationObserver(() => {
      // Debounce: requestAnimationFrame coalesces rapid mutations
      requestAnimationFrame(refresh);
    });

    _observer.observe(chatOutput, { childList: true, subtree: true });
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    _ensureEls();
    if (!_container) return;

    // Restore visibility preference
    try {
      const saved = SafeStorage.get('ac-context-meter-visible');
      if (saved === 'false') {
        _container.style.display = 'none';
        _visible = false;
      }
    } catch (_) {}

    // Initial render (hidden if conversation is empty)
    _container.classList.add('context-meter--hidden');
    _visible = false;
    refresh();

    // Start watching for conversation changes
    _startObserver();

    // Also refresh on storage events (cross-tab session switches)
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith('ac-session')) {
        setTimeout(refresh, 100);
      }
    });
  }

  function destroy() {
    if (_observer) { _observer.disconnect(); _observer = null; }
  }

  return {
    init,
    refresh,
    toggle,
    destroy,
    // Exposed for testing
    _colorClass,
    _fmtK,
    YELLOW_THRESHOLD,
    RED_THRESHOLD
  };
})();

document.addEventListener('DOMContentLoaded', ContextWindowMeter.init);

/* ============================================================
 * ConversationAgenda — per-session goal checklist.
 *
 * Users can define objectives for a chat session (e.g., "Understand
 * React hooks", "Fix the login bug") and check them off as they go.
 * Goals persist per session via SafeStorage. A progress bar shows
 * completion status. Goals can be added, toggled, reordered, and
 * deleted. Keyboard shortcut: Alt+G to toggle panel.
 *
 * @namespace ConversationAgenda
 * ============================================================ */
const ConversationAgenda = (() => {
  'use strict';

  const STORAGE_KEY = 'ac-agenda';
  const MAX_GOALS = 50;
  const MAX_GOAL_LENGTH = 200;

  // { [sessionId]: [{ id, text, done, createdAt }] }
  let agendas = {};
  let panelEl = null;
  let overlayEl = null;
  let styleInjected = false;

  // ── Persistence ──

  function _load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      agendas = raw ? JSON.parse(raw) : {};
    } catch (_) { agendas = {}; }
  }

  function _save() {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(agendas)); } catch (_) {}
  }

  function _sessionId() {
    return (typeof SessionManager !== 'undefined' && SessionManager.currentId)
      ? SessionManager.currentId()
      : '__default';
  }

  function _goals() {
    const sid = _sessionId();
    if (!agendas[sid]) agendas[sid] = [];
    return agendas[sid];
  }

  // ── Styles ──

  function _injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      #agenda-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.5);
        z-index: 1099; display: none;
      }
      #agenda-overlay.agenda-open { display: block; }
      #agenda-panel {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 440px; max-width: 92vw; max-height: 75vh; z-index: 1100;
        background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
        display: none; flex-direction: column; overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      #agenda-panel.agenda-open { display: flex; }
      .agenda-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; border-bottom: 1px solid #30363d;
      }
      .agenda-header h3 { margin: 0; color: #22c55e; font-size: 15px; }
      .agenda-header button {
        background: none; border: none; color: #888; font-size: 18px; cursor: pointer;
      }
      .agenda-progress {
        padding: 8px 16px 4px;
      }
      .agenda-progress-bar {
        height: 6px; background: #21262d; border-radius: 3px; overflow: hidden;
      }
      .agenda-progress-fill {
        height: 100%; background: #22c55e; border-radius: 3px;
        transition: width 0.3s ease;
      }
      .agenda-progress-label {
        font-size: 11px; color: #8b949e; margin-top: 3px; text-align: right;
      }
      .agenda-body {
        flex: 1; overflow-y: auto; padding: 8px 12px;
      }
      .agenda-empty {
        text-align: center; color: #484f58; padding: 24px 0; font-size: 13px;
      }
      .agenda-item {
        display: flex; align-items: center; gap: 8px; padding: 6px 4px;
        border-bottom: 1px solid #161b22; cursor: default;
      }
      .agenda-item:last-child { border-bottom: none; }
      .agenda-item input[type="checkbox"] {
        accent-color: #22c55e; width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;
      }
      .agenda-item-text {
        flex: 1; font-size: 13px; color: #c9d1d9; word-break: break-word;
      }
      .agenda-item.done .agenda-item-text {
        text-decoration: line-through; color: #484f58;
      }
      .agenda-item-delete {
        background: none; border: none; color: #484f58; cursor: pointer;
        font-size: 14px; padding: 2px 4px; opacity: 0; transition: opacity 0.15s;
      }
      .agenda-item:hover .agenda-item-delete { opacity: 1; }
      .agenda-item-delete:hover { color: #f85149; }
      .agenda-footer {
        display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #30363d;
      }
      .agenda-footer input {
        flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 4px;
        color: #c9d1d9; padding: 6px 10px; font-size: 13px; outline: none;
      }
      .agenda-footer input:focus { border-color: #22c55e; }
      .agenda-footer button {
        background: #22c55e; border: none; color: #0d1117; padding: 6px 14px;
        border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 600;
      }
      .agenda-footer button:hover { background: #16a34a; }
      .agenda-clear-btn {
        background: #21262d !important; border: 1px solid #30363d !important;
        color: #8b949e !important; font-weight: normal !important; font-size: 11px !important;
        padding: 4px 10px !important;
      }
      .agenda-clear-btn:hover { color: #f85149 !important; }
    `;
    document.head.appendChild(s);
  }

  // ── UI ──

  function _buildPanel() {
    if (panelEl) return;
    _injectStyles();

    overlayEl = document.createElement('div');
    overlayEl.id = 'agenda-overlay';
    overlayEl.addEventListener('click', close);
    document.body.appendChild(overlayEl);

    panelEl = document.createElement('div');
    panelEl.id = 'agenda-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Conversation Agenda');
    panelEl.innerHTML = `
      <div class="agenda-header">
        <h3>🎯 Agenda</h3>
        <button id="agenda-close-btn" title="Close (Esc)">✕</button>
      </div>
      <div class="agenda-progress">
        <div class="agenda-progress-bar"><div class="agenda-progress-fill" id="agenda-fill"></div></div>
        <div class="agenda-progress-label" id="agenda-progress-label"></div>
      </div>
      <div class="agenda-body" id="agenda-body"></div>
      <div class="agenda-footer">
        <input id="agenda-input" type="text" placeholder="Add a goal…" maxlength="${MAX_GOAL_LENGTH}" autocomplete="off">
        <button id="agenda-add-btn">Add</button>
        <button class="agenda-clear-btn" id="agenda-clear-done-btn" title="Remove completed goals">Clear done</button>
      </div>
    `;
    document.body.appendChild(panelEl);

    panelEl.querySelector('#agenda-close-btn').addEventListener('click', close);
    panelEl.querySelector('#agenda-add-btn').addEventListener('click', _addFromInput);
    panelEl.querySelector('#agenda-clear-done-btn').addEventListener('click', clearDone);

    const input = panelEl.querySelector('#agenda-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _addFromInput(); }
      if (e.key === 'Escape') close();
    });
  }

  function _addFromInput() {
    const input = panelEl.querySelector('#agenda-input');
    const text = (input.value || '').trim();
    if (!text) return;
    addGoal(text);
    input.value = '';
    input.focus();
  }

  function _render() {
    if (!panelEl) return;
    const body = panelEl.querySelector('#agenda-body');
    const goals = _goals();

    if (goals.length === 0) {
      body.innerHTML = '<div class="agenda-empty">No goals yet. Add one below!</div>';
    } else {
      body.innerHTML = goals.map((g, i) => `
        <div class="agenda-item${g.done ? ' done' : ''}" data-index="${i}">
          <input type="checkbox" ${g.done ? 'checked' : ''} title="Toggle goal">
          <span class="agenda-item-text">${_escHtml(g.text)}</span>
          <button class="agenda-item-delete" title="Remove goal">✕</button>
        </div>
      `).join('');

      body.querySelectorAll('.agenda-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const idx = parseInt(e.target.closest('.agenda-item').dataset.index, 10);
          toggleGoal(idx);
        });
      });

      body.querySelectorAll('.agenda-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.closest('.agenda-item').dataset.index, 10);
          removeGoal(idx);
        });
      });
    }

    _updateProgress();
  }

  function _updateProgress() {
    if (!panelEl) return;
    const goals = _goals();
    const fill = panelEl.querySelector('#agenda-fill');
    const label = panelEl.querySelector('#agenda-progress-label');
    const total = goals.length;
    const done = goals.filter(g => g.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = total === 0 ? '' : `${done}/${total} completed (${pct}%)`;
  }

  function _escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── API ──

  function addGoal(text) {
    const goals = _goals();
    if (goals.length >= MAX_GOALS) return false;
    const trimmed = (text || '').trim().slice(0, MAX_GOAL_LENGTH);
    if (!trimmed) return false;
    goals.push({ id: Date.now() + Math.random(), text: trimmed, done: false, createdAt: new Date().toISOString() });
    _save();
    _render();
    return true;
  }

  function toggleGoal(index) {
    const goals = _goals();
    if (index < 0 || index >= goals.length) return;
    goals[index].done = !goals[index].done;
    _save();
    _render();
  }

  function removeGoal(index) {
    const goals = _goals();
    if (index < 0 || index >= goals.length) return;
    goals.splice(index, 1);
    _save();
    _render();
  }

  function clearDone() {
    const sid = _sessionId();
    agendas[sid] = _goals().filter(g => !g.done);
    _save();
    _render();
  }

  function getProgress() {
    const goals = _goals();
    const total = goals.length;
    const done = goals.filter(g => g.done).length;
    return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
  }

  function open() {
    _buildPanel();
    _render();
    panelEl.classList.add('agenda-open');
    if (overlayEl) overlayEl.classList.add('agenda-open');
    const input = panelEl.querySelector('#agenda-input');
    if (input) input.focus();
  }

  function close() {
    if (panelEl) panelEl.classList.remove('agenda-open');
    if (overlayEl) overlayEl.classList.remove('agenda-open');
  }

  function toggle() {
    if (panelEl && panelEl.classList.contains('agenda-open')) close();
    else open();
  }

  function init() {
    _load();

    const btn = document.getElementById('agenda-btn');
    if (btn) btn.addEventListener('click', toggle);

    // Alt+G shortcut
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && panelEl && panelEl.classList.contains('agenda-open')) {
        close();
      }
    });
  }

  return {
    init, open, close, toggle,
    addGoal, toggleGoal, removeGoal, clearDone, getProgress,
    // test helpers
    _load, _goals, _sessionId,
    STORAGE_KEY, MAX_GOALS, MAX_GOAL_LENGTH
  };
})();

document.addEventListener('DOMContentLoaded', ConversationAgenda.init);

/* ── Offline Detection & Service Worker Registration ───────────────── */
const OfflineManager = (function () {
  'use strict';

  var banner = null;
  var sendBtn = null;
  var _wasOffline = false;

  function init() {
    banner = document.getElementById('offline-banner');
    sendBtn = document.getElementById('send-btn');
    var dismissBtn = document.getElementById('offline-dismiss');

    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        if (banner) banner.style.display = 'none';
      });
    }

    window.addEventListener('online', _onOnline);
    window.addEventListener('offline', _onOffline);

    /* Check initial state */
    if (!navigator.onLine) {
      _onOffline();
    }

    /* Register service worker */
    _registerSW();
  }

  function _onOffline() {
    _wasOffline = true;
    if (banner) banner.style.display = '';
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.title = 'Cannot send — you are offline';
    }
  }

  function _onOnline() {
    if (banner) banner.style.display = 'none';
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.title = '';
    }
    if (_wasOffline) {
      _wasOffline = false;
      console.log('[OfflineManager] Connection restored');
    }
  }

  function _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(function (reg) {
          console.log('[SW] Registered, scope:', reg.scope);
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', function () {
                if (newWorker.state === 'activated') {
                  console.log('[SW] New version activated');
                }
              });
            }
          });
        })
        .catch(function (err) {
          console.warn('[SW] Registration failed:', err.message);
        });
    }
  }

  function isOffline() {
    return !navigator.onLine;
  }

  return { init: init, isOffline: isOffline };
})();

document.addEventListener('DOMContentLoaded', OfflineManager.init);
