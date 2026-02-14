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

  return {
    getHistory()   { return history; },
    getMessages()  { return [...history]; },

    addMessage(role, content) {
      history.push({ role, content });
    },

    /** Remove the last message (used on API failure). */
    popLast() {
      if (history.length > 1) history.pop();
    },

    /** Keep at most MAX_HISTORY_PAIRS user+assistant exchanges. */
    trim() {
      const messages = history.slice(1);
      const max = ChatConfig.MAX_HISTORY_PAIRS * 2;
      if (messages.length > max) {
        const trimmed = messages.slice(messages.length - max);
        history.length = 0;
        history.push({ role: 'system', content: ChatConfig.SYSTEM_PROMPT }, ...trimmed);
      }
    },

    clear() {
      history.length = 0;
      history.push({ role: 'system', content: ChatConfig.SYSTEM_PROMPT });
    },

    /** Rough token estimate based on character count. */
    estimateTokens() {
      const chars = history.reduce((sum, m) => sum + m.content.length, 0);
      return Math.ceil(chars / ChatConfig.CHARS_PER_TOKEN);
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
  let pendingResolve = null;
  let pendingCode = null;
  let pendingDomain = null;

  function getOpenAIKey()       { return openaiKey; }
  function setOpenAIKey(key)    { openaiKey = key; }
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
      return code.replace(/YOUR_API_KEY/g, serviceKeys[domain]);
    }

    // Show modal — store pending state
    pendingCode = code;
    pendingDomain = domain;
    return null; // caller should not run yet
  }

  /** Called when the user submits a key in the modal. */
  function submitServiceKey(key) {
    if (!key || !pendingDomain) return null;
    serviceKeys[pendingDomain] = key;
    const code = pendingCode.replace(/YOUR_API_KEY/g, key);
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
  const el = (id) => document.getElementById(id);

  function setChatOutput(text)    { el('chat-output').textContent = text; }
  function setChatOutputHTML(html) { el('chat-output').innerHTML = html; }
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
      el('send-btn').disabled = true;
      el('send-btn').textContent = 'Running…';
    }
  }

  function resetSandboxUI() {
    setSandboxRunning(false);
    el('send-btn').disabled = false;
    el('send-btn').textContent = 'Send';
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
    inp.focus();
  }

  function removeApiKeyInput() {
    const inp = el('api-key');
    if (inp) { inp.value = ''; inp.remove(); }
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
  function clearChatInput() { el('chat-input').value = ''; el('chat-input').focus(); }
  function getApiKeyInput() { const inp = el('api-key'); return inp ? inp.value.trim() : ''; }
  function getServiceKeyInput() { return el('user-api-key').value.trim(); }

  function displayCode(code) {
    const pre = document.createElement('pre');
    pre.textContent = code;
    setChatOutputHTML('');
    el('chat-output').appendChild(pre);
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
    setChatOutput, setChatOutputHTML, setConsoleOutput, setLastPrompt,
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
      ApiKeyManager.setOpenAIKey(keyVal);
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
        await executeCode(codeMatch[1]);
      } else {
        UIController.setChatOutput(reply);
        UIController.setConsoleOutput('(no code to run)');
      }
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
});
