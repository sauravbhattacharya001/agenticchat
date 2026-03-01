/* ============================================================
 * Agentic Chat — Application Logic
 *
 * Architecture (17 modules, all revealing-module-pattern IIFEs):
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
 *
 * All modules communicate through a thin public API; no direct DOM
 * manipulation outside UIController except where unavoidable (sandbox).
 * ============================================================ */

'use strict';

/* ---------- Configuration ---------- */
const ChatConfig = Object.freeze({
  MODEL: 'gpt-4o',
  MAX_TOKENS_RESPONSE: 4096,
  MAX_HISTORY_PAIRS: 20,        // 20 user+assistant pairs ≈ 40 messages
  MAX_INPUT_CHARS: 50000,       // ~12,500 tokens
  MAX_TOTAL_TOKENS: 100000,
  CHARS_PER_TOKEN: 4,
  TOKEN_WARNING_THRESHOLD: 80000,
  SANDBOX_TIMEOUT_MS: 30000,

  SYSTEM_PROMPT: `
You are an autonomous agent in a browser.
Only reply with JavaScript in a single code block.
If an external service needs a key use the placeholder "YOUR_API_KEY".
Always \`return\` the final value.
  `.trim()
});

/* ---------- Shared Utilities ---------- */

/** Format an ISO timestamp as relative time (e.g. "2h ago", "3d ago"). */
function formatRelativeTime(isoString) {
  var now = Date.now();
  var then = new Date(isoString).getTime();
  var diff = now - then;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  return new Date(isoString).toLocaleDateString();
}

/** Trigger a browser file download from in-memory content. */
function downloadBlob(filename, content, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  function recomputeCharCount() {
    cachedCharCount = history.reduce((sum, m) => sum + m.content.length, 0);
    charCountDirty = false;
  }

  return {
    getHistory()   { return history; },
    getMessages()  { return [...history]; },

    addMessage(role, content) {
      history.push({ role, content });
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
          var code = evt.data.code;
          var nonce = evt.data.nonce;
          try {
            var fn = new Function('return (async () => {' + code + '})()');
            var __result = await fn();
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

  function cancel() {
    if (cleanupFn) cleanupFn();
  }

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

  function getOpenAIKey()       { return openaiKey; }
  function setOpenAIKey(key)    {
    // Validate key format: OpenAI keys start with "sk-" followed by alphanumerics
    if (!/^sk-[A-Za-z0-9_-]{6,}$/.test(key)) {
      throw new Error('Invalid API key format. OpenAI keys start with "sk-".');
    }
    openaiKey = key;
  }
  function clearOpenAIKey()     { openaiKey = null; }

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
  function el(id) {
    let node = _cache[id];
    if (!node) {
      node = document.getElementById(id);
      if (node) _cache[id] = node;
    }
    return node;
  }

  function setChatOutput(text)    { el('chat-output').textContent = text; }
  function setConsoleOutput(text, color) {
    const out = el('console-output');
    out.textContent = text;
    if (color) out.style.color = color;
  }
  function setLastPrompt(text)    { el('last-prompt').textContent = text; }

  function setSendingState(sending) {
    const btn = el('send-btn');
    const input = el('chat-input');
    btn.disabled = sending;
    btn.textContent = sending ? 'Sending…' : 'Send';
    input.disabled = sending;
  }

  function setSandboxRunning(running) {
    el('cancel-btn').style.display = running ? 'inline-block' : 'none';
    if (running) {
      const btn = el('send-btn');
      btn.disabled = true;
      btn.textContent = 'Running…';
    }
  }

  function resetSandboxUI() {
    setSandboxRunning(false);
    const btn = el('send-btn');
    btn.disabled = false;
    btn.textContent = 'Send';
  }

  function showTokenUsage(usage) {
    if (!usage) return;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = usage.total_tokens || (prompt + completion);
    const cost = (prompt * 2.5 + completion * 10) / 1_000_000;
    el('token-usage').textContent =
      `Tokens: ${prompt} in / ${completion} out (${total} total) · ~$${cost.toFixed(4)}`;
  }

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

  function removeApiKeyInput() {
    const inp = el('api-key');
    if (inp) {
      inp.value = '';
      inp.remove();
      delete _cache['api-key'];
    }
  }

  function showServiceKeyModal(domain) {
    el('api-service-name').textContent = domain;
    el('apikey-modal').style.display = 'flex';
    el('user-api-key').focus();
  }

  function hideServiceKeyModal() {
    el('apikey-modal').style.display = 'none';
    el('user-api-key').value = '';
  }

  function getChatInput()   { return el('chat-input').value.trim(); }
  function clearChatInput() { const inp = el('chat-input'); inp.value = ''; inp.focus(); }
  function getApiKeyInput() { const inp = el('api-key'); return inp ? inp.value.trim() : ''; }
  function getServiceKeyInput() { return el('user-api-key').value.trim(); }

  function displayCode(code) {
    const container = el('chat-output');
    container.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = code;
    container.appendChild(pre);
  }

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
    setChatOutput, setConsoleOutput, setLastPrompt,
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

  async function callOpenAI(key, messages) {
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
      })
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

    return { ok: true, data: await rsp.json() };
  }

  /** Execute sandbox code, handling service-key substitution. */
  async function executeCode(code) {
    const substituted = ApiKeyManager.substituteServiceKey(code);
    if (substituted === null) {
      // Need a service key from user — modal is shown via UI
      UIController.showServiceKeyModal(ApiKeyManager.getPendingDomain());
      return;
    }
    await runInSandbox(substituted);
  }

  async function runInSandbox(code) {
    UIController.setConsoleOutput('(running in sandbox…)');
    UIController.setSandboxRunning(true);

    const result = await SandboxRunner.run(code);

    UIController.setConsoleOutput(result.value, result.ok ? '#4ade80' : '#f87171');
    UIController.resetSandboxUI();
  }

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
    UIController.setChatOutput('Thinking…');
    UIController.setConsoleOutput('(processing)');

    try {
      ConversationManager.addMessage('user', prompt);

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

      const reply = result.data.choices?.[0]?.message?.content || 'No response';
      ConversationManager.addMessage('assistant', reply);
      ConversationManager.trim();
      UIController.showTokenUsage(result.data.usage);

      // Warn if history is getting large
      if (ConversationManager.estimateTokens() > ChatConfig.TOKEN_WARNING_THRESHOLD) {
        console.warn('[agenticchat] History tokens high — consider clicking Clear');
      }

      // Extract and run code, or display text
      const codeMatch = reply.match(/```(?:js|javascript)?\n([\s\S]*?)```/i);
      if (codeMatch) {
        UIController.displayCode(codeMatch[1]);
        SnippetLibrary.setCurrentCode(codeMatch[1]);
        await executeCode(codeMatch[1]);
      } else {
        UIController.setChatOutput(reply);
        UIController.setConsoleOutput('(no code to run)');
        SnippetLibrary.setCurrentCode(null);
      }

      // Update history panel if open
      HistoryPanel.refresh();

      // Auto-save session if enabled
      SessionManager.autoSaveIfEnabled();
    } catch (err) {
      if (ConversationManager.getHistory().length > 1 &&
          ConversationManager.getHistory().at(-1).role === 'user') {
        ConversationManager.popLast();
      }
      UIController.setChatOutput('Network error: ' + err.message);
      UIController.setConsoleOutput('(request failed)');
    } finally {
      isSending = false;
      UIController.setSendingState(false);
      UIController.clearChatInput();
    }
  }

  function clearHistory() {
    ConversationManager.clear();
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt('(history cleared)');
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    HistoryPanel.refresh();
  }

  /** Handle service-key modal submission. */
  async function submitServiceKey() {
    const key = UIController.getServiceKeyInput();
    const code = ApiKeyManager.submitServiceKey(key);
    UIController.hideServiceKeyModal();
    if (code) await runInSandbox(code);
  }

  return { send, clearHistory, submitServiceKey };
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
      roleLabel.textContent = msg.role === 'user' ? '👤 You' : '🤖 Assistant';
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
    container.innerHTML = '';
    container.appendChild(fragment);

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Decorate messages with reaction bars
    MessageReactions.decorateMessages();
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

  return { toggle, close, refresh, exportAsMarkdown, exportAsJSON };
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
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Save snippets to localStorage. Returns true on success, false on failure. */
  function save(snippets) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
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
    var MAX_SNIPPET_NAME = 200;
    var MAX_SNIPPET_CODE = 500000; // 500 KB
    var MAX_SNIPPETS = 200;

    var snippets = load();

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
    // Remove current indicator from all marks
    for (let i = 0; i < matches.length; i++) {
      matches[i].classList.remove('search-current');
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { bookmarks = []; return; }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { bookmarks = []; return; }
      bookmarks = parsed;
    } catch (_) {
      bookmarks = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
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
        { name: 'reactions', description: 'Toggle reactions in history', icon: '😀',
          action: () => HistoryPanel.toggle() },
        { name: 'save', description: 'Save current session', icon: '💾',
          action: () => SessionManager.save() },
        { name: 'help', description: 'Show available commands', icon: '❓',
          action: () => { /* opening dropdown is the action */ } },
        { name: 'stats', description: 'Show chat statistics', icon: '📊',
          action: () => ChatStats.toggle() },
        { name: 'sessions', description: 'Toggle sessions panel', icon: '📋',
          action: () => SessionManager.toggle() },
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
            localStorage.setItem(STORAGE_KEY, JSON.stringify(reactions));
        } catch (e) {
            // Storage full — silent fail
        }
    }
    
    function load() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    reactions = parsed;
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
        localStorage.removeItem(STORAGE_KEY);
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

    // Ctrl+I — toggle chat statistics
    if (ctrl && e.key === 'i') {
      e.preventDefault();
      ChatStats.toggle();
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
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved && typeof saved === 'string' && saved.length >= 2 && saved.length <= 10) {
        return saved;
      }
    } catch (_) { /* localStorage unavailable */ }
    return DEFAULT_LANG;
  }

  /** Persist language preference to localStorage. */
  function _saveLanguage(lang) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
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
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
  }

  function _loadSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
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
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Save all sessions to localStorage with quota protection. */
  function _saveAll(sessions) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            // Try to recover: evict oldest sessions and retry
            const recovered = _evictOldest(sessions, 5);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered));
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
  }

  /** Evict the N oldest sessions (by updatedAt). */
  function _evictOldest(sessions, count) {
    if (sessions.length <= count) return [];
    const sorted = [...sessions].sort((a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
    return sorted.slice(count);
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
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            total += key.length + (localStorage.getItem(key) || '').length;
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
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  }
  function _setActiveId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
  }

  /** Initialize auto-save preference. */
  function initAutoSave() {
    try {
      autoSave = localStorage.getItem(AUTO_SAVE_KEY) === 'true';
    } catch { autoSave = false; }
    _updateAutoSaveUI();
  }

  function isAutoSaveEnabled() { return autoSave; }

  function toggleAutoSave() {
    autoSave = !autoSave;
    try { localStorage.setItem(AUTO_SAVE_KEY, String(autoSave)); } catch {}
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

    const activeId = _getActiveId();
    if (activeId) {
      // Update existing session silently
      save();
    } else {
      // Create a new auto-named session
      save();
    }
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

  /** Load a session by ID — replaces current conversation. */
  function load(id) {
    const sessions = _loadAll();
    const session = sessions.find(s => s.id === id);
    if (!session) return null;

    // Save current session first if auto-save is on
    const currentMessages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (autoSave && currentMessages.length > 0) {
      save();
    }

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

    // Update UI — clear stale bookmarks from the previous conversation
    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt(`Loaded: ${session.name}`);
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    HistoryPanel.refresh();

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
    const currentMessages = ConversationManager.getMessages().filter(m => m.role !== 'system');
    if (autoSave && currentMessages.length > 0) {
      save();
    }

    ConversationManager.clear();
    _setActiveId(null);

    UIController.setChatOutput('');
    UIController.setConsoleOutput('(results appear here)');
    UIController.setLastPrompt('(new session)');
    SnippetLibrary.setCurrentCode(null);
    ChatBookmarks.clearAll();
    HistoryPanel.refresh();
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
      const data = JSON.parse(jsonString);
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
    _isOpen: function () { return isOpen; },
    // Exposed for testing
    _loadAll, _saveAll, _getActiveId, _setActiveId,
    _evictOldest, _enforceSessionLimit, _estimateQuotaUsage, _checkQuota
  };
})();

/* ---------- Conversation Sessions (facade) ---------- */
const ConversationSessions = (function () {
  var _confirmPending = false;

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
    var sessions = SessionManager._loadAll();
    var session = sessions.find(function (s) { return s.id === id; });
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
    var q = query.toLowerCase();
    var sessions = SessionManager.getAll();
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
    var sessions = SessionManager._loadAll();
    var session = sessions.find(function (s) { return s.id === id; });
    if (!session) return null;
    var msgs = session.messages || [];
    var wordCount = 0;
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
            <span class="stats-word-label">${tw.word}</span>
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

/* ---------- Event Bindings ---------- */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('send-btn').addEventListener('click', ChatController.send);
  document.getElementById('cancel-btn').addEventListener('click', SandboxRunner.cancel);
  document.getElementById('clear-btn').addEventListener('click', ChatController.clearHistory);

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ChatController.send(); }
  });

  document.getElementById('chat-input').addEventListener('input', function () {
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

  // Templates panel
  document.getElementById('templates-btn').addEventListener('click', PromptTemplates.toggle);
  document.getElementById('templates-close-btn').addEventListener('click', PromptTemplates.close);
  document.getElementById('templates-overlay').addEventListener('click', PromptTemplates.close);
  document.getElementById('templates-search').addEventListener('input', PromptTemplates.handleSearchDebounced);

  // Keyboard shortcut: Escape closes history panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      HistoryPanel.close();
      PromptTemplates.close();
      SnippetLibrary.close();
      SnippetLibrary.closeSaveDialog();
      SessionManager.close();
      SessionManager.closeSaveDialog();
      KeyboardShortcuts.hideHelp();
      ChatStats.close();
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

  // Slash commands
  SlashCommands.init();

  // Message reactions
  MessageReactions.init();

  // Stats button
  document.getElementById('stats-btn').addEventListener('click', ChatStats.toggle);
});
