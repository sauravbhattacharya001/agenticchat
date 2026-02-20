/* ============================================================
 * Agentic Chat — Application Logic
 *
 * Architecture:
 *   ChatConfig     — constants and configuration
 *   ConversationManager — history management (add, trim, clear, token estimation)
 *   SandboxRunner  — iframe sandbox creation, execution, cancellation
 *   ApiKeyManager  — OpenAI key + per-service key storage, modal handling
 *   UIController   — DOM updates, button state, character count
 *   ChatController — orchestrates sending messages, processing responses
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

/* ---------- Conversation Manager ---------- */
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
const SandboxRunner = (() => {
  let cleanupFn = null;

  /**
   * Execute code inside a sandboxed iframe.
   * Returns a Promise that resolves with { ok, value }.
   */
  function run(code) {
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
   * Prevents breakout via quotes, backslashes, backticks, or newlines.
   */
  function sanitizeKeyForCodeInjection(key) {
    return key
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
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

  return {
    getOpenAIKey, setOpenAIKey, clearOpenAIKey,
    substituteServiceKey, submitServiceKey,
    getPendingDomain, extractDomain
  };
})();

/* ---------- UI Controller ---------- */
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
const HistoryPanel = (() => {
  let isOpen = false;

  function toggle() {
    isOpen = !isOpen;
    const panel = document.getElementById('history-panel');
    const overlay = document.getElementById('history-overlay');
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
    document.getElementById('history-panel').classList.remove('open');
    document.getElementById('history-overlay').classList.remove('visible');
  }

  /**
   * Rebuild the history panel DOM.
   * Uses DocumentFragment for batch DOM insertion (single reflow/repaint).
   */
  function refresh() {
    const container = document.getElementById('history-messages');
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

    downloadFile(`agenticchat-${timestamp}.md`, md, 'text/markdown');
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

    downloadFile(`agenticchat-${timestamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { toggle, close, refresh, exportAsMarkdown, exportAsJSON };
})();

/* ---------- Snippet Library ---------- */
const SnippetLibrary = (() => {
  const STORAGE_KEY = 'agenticchat_snippets';
  let isOpen = false;
  let currentCode = null;  // code displayed in chat-output for save
  let _searchTimer = null;

  /** Load snippets from localStorage. */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Save snippets to localStorage. */
  function save(snippets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  }

  function getAll() { return load(); }

  function getCount() { return load().length; }

  /** Add a new snippet. */
  function add(name, code, tags) {
    const snippets = load();
    snippets.unshift({
      id: crypto.randomUUID(),
      name: name.trim(),
      code,
      tags: tags.map(t => t.trim()).filter(t => t.length > 0),
      createdAt: new Date().toISOString()
    });
    save(snippets);
    return snippets;
  }

  /** Delete a snippet by ID. */
  function remove(id) {
    const snippets = load().filter(s => s.id !== id);
    save(snippets);
    return snippets;
  }

  /** Rename a snippet. */
  function rename(id, newName) {
    const snippets = load();
    const snippet = snippets.find(s => s.id === id);
    if (snippet) snippet.name = newName.trim();
    save(snippets);
    return snippets;
  }

  /** Clear all snippets. */
  function clearAll() {
    save([]);
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
    const actionsEl = document.getElementById('code-actions');
    if (actionsEl) actionsEl.style.display = code ? 'flex' : 'none';
  }

  function getCurrentCode() { return currentCode; }

  /** Open save dialog for current code. */
  function openSaveDialog() {
    if (!currentCode) return;
    const modal = document.getElementById('snippet-save-modal');
    const nameInput = document.getElementById('snippet-name-input');
    const tagsInput = document.getElementById('snippet-tags-input');
    const preview = document.getElementById('snippet-code-preview');

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
    const nameInput = document.getElementById('snippet-name-input');
    const tagsInput = document.getElementById('snippet-tags-input');

    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (!currentCode) return;

    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    add(name, currentCode, tags);
    closeSaveDialog();

    // Show brief confirmation
    const actionsEl = document.getElementById('code-actions');
    const saveBtn = document.getElementById('save-snippet-btn');
    if (saveBtn) {
      saveBtn.textContent = '✅ Saved!';
      setTimeout(() => { saveBtn.textContent = '💾 Save Snippet'; }, 1500);
    }

    // Refresh snippets panel if open
    if (isOpen) refresh();
  }

  function closeSaveDialog() {
    const modal = document.getElementById('snippet-save-modal');
    if (modal) modal.style.display = 'none';
  }

  /** Copy current code to clipboard. */
  function copyCurrentCode() {
    if (!currentCode) return;
    navigator.clipboard.writeText(currentCode).then(() => {
      const btn = document.getElementById('copy-code-btn');
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
    const panel = document.getElementById('snippets-panel');
    const overlay = document.getElementById('snippets-overlay');
    if (isOpen) {
      panel.classList.add('open');
      overlay.classList.add('visible');
      const searchInput = document.getElementById('snippets-search');
      if (searchInput) { searchInput.value = ''; searchInput.focus(); }
      refresh();
    } else {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function close() {
    isOpen = false;
    const panel = document.getElementById('snippets-panel');
    const overlay = document.getElementById('snippets-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  /** Render snippets list. */
  function refresh() {
    const searchInput = document.getElementById('snippets-search');
    const query = searchInput ? searchInput.value.trim() : '';
    const snippets = search(query);
    render(snippets);
  }

  function render(snippets) {
    const container = document.getElementById('snippets-list');
    const countEl = document.getElementById('snippets-count');
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
        const input = document.getElementById('chat-input');
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
        remove(snippet.id);
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

  /** Format relative time (e.g. "2h ago", "3d ago"). */
  function formatRelativeTime(isoString) {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString();
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
    clearAll();
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

/* ---------- Keyboard Shortcuts ---------- */
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
      SnippetLibrary.toggle();
      return;
    }

    // Ctrl+K — focus chat input
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      if (input) input.focus();
      return;
    }

    // Ctrl+M — toggle voice input
    if (ctrl && e.key === 'm') {
      e.preventDefault();
      const voiceBtn = document.getElementById('voice-btn');
      if (voiceBtn && !voiceBtn.disabled) voiceBtn.click();
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
  }

  return { showHelp, hideHelp, toggleHelp, isOpen, handleKeydown, isInputFocused };
})();

/* ---------- Voice Input ---------- */
const VoiceInput = (() => {
  let recognition = null;
  let isListening = false;
  let finalTranscript = '';
  let interimTranscript = '';
  let _onResult = null;
  let _onStateChange = null;
  let _autoSend = false;

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
    recognition.lang = 'en-US';
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

  /** Set the recognition language (e.g. 'en-US', 'es-ES', 'fr-FR'). */
  function setLanguage(lang) {
    if (recognition) recognition.lang = lang;
  }

  /** Get current language. */
  function getLanguage() {
    return recognition ? recognition.lang : 'en-US';
  }

  return {
    isSupported, start, stop, toggle,
    getIsListening, getFinalTranscript, getInterimTranscript,
    onResult, onStateChange, setLanguage, getLanguage
  };
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
      KeyboardShortcuts.hideHelp();
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
});
