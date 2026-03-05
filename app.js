/* ============================================================
 * Agentic Chat — Application Logic
 *
 * Architecture (19 modules, all revealing-module-pattern IIFEs):
 *
 *   Core:
 *   ChatConfig          — constants and configuration
 *   ConversationManager — history management (add, trim, clear, token estimation)
 *   SandboxRunner       — iframe sandbox for executing LLM-generated code
 *   ApiKeyManager       — OpenAI key + per-service key storage, modal handling
 *   UIController        — DOM updates, button state, character count
 *   ChatController      — orchestrates sending messages, processing responses
 *
 *   Features:
 *   PromptTemplates     — categorized prompt library with search and one-click insert
 *   HistoryPanel        — slide-out conversation history with export/import
 *   SnippetLibrary      — persistent code snippet storage with tagging and search
 *   MessageSearch       — full-text search across conversation messages
 *   ChatBookmarks       — bookmark individual messages for quick reference
 *   SlashCommands       — slash-command dropdown (autocomplete, keyboard nav)
 *   MessageReactions    — per-message emoji reactions with persistent counts
 *   KeyboardShortcuts   — global keyboard shortcuts with help modal
 *   VoiceInput          — browser speech recognition with language selection
 *   ThemeManager        — dark/light theme with OS preference detection
 *   SessionManager      — multi-session persistence with auto-save and quota mgmt
 *   ChatStats           — conversation analytics (word counts, code blocks, timing)
 *   InputHistory        — navigate previous prompts with ↑/↓ arrow keys
 *   ConversationFork    — branch conversations from any message into new sessions
 *   ReadAloud           — text-to-speech for messages with voice/speed controls
 *   MessageDiff         — compare any two messages with visual line-level diff
 *   ConversationTimeline — visual minimap sidebar for conversation navigation
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
    SafeStorage.set(k, '1');
    SafeStorage.remove(k);
    available = true;
  } catch (_) { /* storage unavailable */ }

  return {
    get(key) {
      try { return available ? SafeStorage.get(key) : null; } catch (_) { return null; }
    },
    set(key, value) {
      try { if (available) SafeStorage.set(key, value); } catch (_) { /* quota or access error */ }
    },
    remove(key) {
      try { if (available) SafeStorage.remove(key); } catch (_) { /* ignore */ }
    },
    get length() {
      try { return available ? SafeStorage.length : 0; } catch (_) { return 0; }
    },
    key(i) {
      try { return available ? SafeStorage.key(i) : null; } catch (_) { return null; }
    },
    isAvailable() { return available; },
  };
})();

/* ---------- Configuration ---------- */
const ChatConfig = (() => {
  const _cfg = {
    _model: SafeStorage.get('ac-selected-model') || 'gpt-4o',
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
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'gpt-4', label: 'GPT-4' },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
      { id: 'o1-preview', label: 'o1 Preview' },
      { id: 'o1-mini', label: 'o1 Mini' },
      { id: 'o3-mini', label: 'o3 Mini' }
    ],
    /** Per-model pricing in USD per 1M tokens: [input, output]. */
    MODEL_PRICING: {
      'gpt-4o':         [2.50,  10.00],
      'gpt-4o-mini':    [0.15,   0.60],
      'gpt-4-turbo':    [10.00,  30.00],
      'gpt-4':          [30.00,  60.00],
      'gpt-3.5-turbo':  [0.50,   1.50],
      'o1-preview':     [15.00,  60.00],
      'o1-mini':        [3.00,   12.00],
      'o3-mini':        [1.10,   4.40]
    },
    get MODEL() { return _cfg._model; },
    set MODEL(v) { _cfg._model = v; SafeStorage.set('ac-selected-model', v); }
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
      SafeStorage.set('ac-show-timing', JSON.stringify(showTimingBadges));
      return showTimingBadges;
    },

    addMessage(role, content, meta) {
      const entry = { role, content };
      if (meta && meta.responseTimeMs !== undefined) {
        entry.responseTimeMs = meta.responseTimeMs;
        entry.timestamp = meta.timestamp || Date.now();
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
  function setChatOutput(text)    { el('chat-output').textContent = text; }
  /** Append text to the chat output area (used during streaming). */
  function appendChatOutput(text)  { el('chat-output').textContent += text; }
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
    getChatInput, clearChatInput, getApiKeyInput, getServiceKeyInput,
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

    const reader = rsp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
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
            fullText += delta;
            onToken(delta);
          }
        } catch (_) { /* skip malformed chunks */ }
      }
    }

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

        if (!result.ok) {
          ConversationManager.popLast();
          UIController.setChatOutput(result.error);
          UIController.setConsoleOutput('(request failed)');

          if (result.status === 401) {
            ApiKeyManager.clearOpenAIKey();
            UIController.showApiKeyInput();
          }
          return;
        }

        reply = result.text || 'No response';
        usage = result.usage;
      } else {
        // Non-streaming path — original behavior
        UIController.setChatOutput('Thinking…');
        const result = await callOpenAI(
          ApiKeyManager.getOpenAIKey(),
          ConversationManager.getMessages()
        );

        if (!result.ok) {
          ConversationManager.popLast();
          UIController.setChatOutput(result.error);
          UIController.setConsoleOutput('(request failed)');

          if (result.status === 401) {
            ApiKeyManager.clearOpenAIKey();
            UIController.showApiKeyInput();
          }
          return;
        }

        reply = result.data.choices?.[0]?.message?.content || 'No response';
        usage = result.data.usage;
      }

      const responseTimeMs = Math.round(performance.now() - sendStartTime);
      ConversationManager.addMessage('assistant', reply, { responseTimeMs, timestamp: Date.now() });
      ConversationManager.trim();
      UIController.showTokenUsage(usage);

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
      if (err.name === 'AbortError') {
        UIController.setChatOutput('(request cancelled)');
        UIController.setConsoleOutput('(cancelled)');
        if (ConversationManager.getHistory().length > 1 &&
            ConversationManager.getHistory().at(-1).role === 'user') {
          ConversationManager.popLast();
        }
      } else if (err.name === 'TimeoutError') {
        UIController.setChatOutput('Request timed out — try again.');
        UIController.setConsoleOutput('(timed out)');
        if (ConversationManager.getHistory().length > 1 &&
            ConversationManager.getHistory().at(-1).role === 'user') {
          ConversationManager.popLast();
        }
      } else {
      if (ConversationManager.getHistory().length > 1 &&
          ConversationManager.getHistory().at(-1).role === 'user') {
        ConversationManager.popLast();
      }
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

      // For assistant messages, check for code blocks
      if (msg.role === 'assistant') {
        const codeMatch = msg.content.match(/```(?:js|javascript)?\n([\s\S]*?)```/i);
        if (codeMatch) {
          const beforeCode = msg.content.substring(0, msg.content.indexOf('```')).trim();
          if (beforeCode) {
            const textEl = document.createElement('div');
            textEl.className = 'msg-text';
            textEl.textContent = beforeCode;
            div.appendChild(textEl);
          }
          const pre = document.createElement('pre');
          pre.textContent = codeMatch[1];
          div.appendChild(pre);
          const afterIdx = msg.content.indexOf('```', msg.content.indexOf('```') + 3);
          const afterCode = afterIdx >= 0 ? msg.content.substring(afterIdx + 3).trim() : '';
          if (afterCode) {
            const textEl = document.createElement('div');
            textEl.className = 'msg-text';
            textEl.textContent = afterCode;
            div.appendChild(textEl);
          }
        } else {
          const textEl = document.createElement('div');
          textEl.className = 'msg-text';
          textEl.textContent = msg.content;
          div.appendChild(textEl);
        }
      } else {
        const textEl = document.createElement('div');
        textEl.className = 'msg-text';
        textEl.textContent = msg.content;
        div.appendChild(textEl);
      }

      fragment.appendChild(div);
    }

    // Single DOM mutation: clear + append fragment
    container.textContent = '';
    container.appendChild(fragment);

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Decorate messages with reaction bars
    MessageReactions.decorateMessages();
    ConversationFork.decorateMessages();
    ReadAloud.decorateMessages();
  }

  function exportAsMarkdown() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let md = `# Agentic Chat Export\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;

    messages.forEach((msg) => {
      const role = msg.role === 'user' ? '👤 **You**' : '🤖 **Assistant**';
      md += `### ${role}\n\n${msg.content}\n\n---\n\n`;
    });

    downloadBlob(`agenticchat-${timestamp}.md`, md, 'text/markdown');
  }

  function exportAsJSON() {
    const messages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (messages.length === 0) {
      alert('No conversation to export.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dateStr = new Date().toLocaleString();

    function escapeHTML(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

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

  return { toggle, close, refresh, exportAsMarkdown, exportAsJSON, exportAsHTML };
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
            SafeStorage.set('ac-streaming', JSON.stringify(ChatConfig.STREAMING_ENABLED));
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
        { name: 'timing', description: 'Toggle response time badges on/off', icon: '⏱️',
          action: () => {
            const visible = ConversationManager.toggleTiming();
            if (!visible) ResponseTimeBadge.hide();
            UIController.setChatOutput(`Response timing badges ${visible ? 'enabled ⏱️' : 'hidden'}`);
          } },
        { name: 'input-history', description: 'Clear prompt history (↑/↓ navigation)', icon: '🕐',
          action: () => {
            const count = InputHistory.getCount();
            InputHistory.clearAll();
            UIController.setChatOutput(`Cleared ${count} prompt${count !== 1 ? 's' : ''} from input history.`);
          } },
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

    // Ctrl+S — toggle snippets panel
    if (ctrl && e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        SessionManager.toggle();
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

  /** Load all sessions from localStorage. */
  function _loadAll() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      return raw ? sanitizeStorageObject(JSON.parse(raw)) : [];
    } catch { return []; }
  }

  /** Save all sessions to localStorage with quota protection. */
  function _saveAll(sessions) {
    try {
        SafeStorage.set(STORAGE_KEY, JSON.stringify(sessions));
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            // Incrementally evict oldest sessions one at a time until it fits,
            // but always keep at least one session to prevent total data loss.
            let remaining = [...sessions];
            while (remaining.length > 1) {
                remaining = _evictOldest(remaining, 1);
                try {
                    SafeStorage.set(STORAGE_KEY, JSON.stringify(remaining));
                    console.warn(`[SessionManager] Evicted session to fit quota. ${remaining.length} sessions remain.`);
                    return true;
                } catch { /* continue evicting */ }
            }
            // Last resort: try saving the single remaining session
            try {
                SafeStorage.set(STORAGE_KEY, JSON.stringify(remaining));
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

    sessions.forEach(session => {
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
      // Another tab modified sessions
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

  /** Escape HTML special characters to prevent XSS in rendered stats. */
  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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

/* ---------- Persona / System Prompt Presets ---------- */

/**
 * Manages switchable system prompt presets (personas).
 * Users can pick from built-in presets or define a custom system prompt.
 * The active persona persists in localStorage.
 */
const PersonaPresets = (() => {
  const STORAGE_KEY = 'agenticchat_persona';
  let isOpen = false;

  /** Escape HTML special characters to prevent XSS in rendered presets. */
  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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
    SafeStorage.set(STORAGE_KEY, JSON.stringify(data));
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
    SafeStorage.set(STORAGE_KEY, JSON.stringify(active));
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
        const parsed = JSON.parse(raw);
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

  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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

  return { forkAt, decorateMessages };
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
        const parsed = JSON.parse(raw);
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
        let parsed = JSON.parse(data);
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
    // Listen for chat output changes via MutationObserver
    let chatOutput = document.getElementById('chat-output');
    if (chatOutput) {
      const observer = new MutationObserver(function () { refresh(); });
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

  function escapeHtml(text) {
    let div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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

  // Focus / Zen mode
  document.getElementById('zen-btn').addEventListener('click', FocusMode.toggle);
  FocusMode.init();

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

  // Cross-tab sync (must come after SessionManager.initAutoSave)
  CrossTabSync.init();
});
