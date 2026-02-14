# Agentic Chat

A lightweight browser-based chat interface that turns natural language prompts into executable JavaScript — powered by OpenAI's GPT-4o.

## What It Does

Type a question or task in plain English, and the app:

1. Sends your prompt to GPT-4o with a system prompt instructing it to reply with JavaScript code
2. Extracts the code block from the response
3. Executes it directly in your browser
4. Displays the result

If the generated code needs an external API key (e.g., for a weather service), the app detects the `YOUR_API_KEY` placeholder and prompts you to enter it. Keys are cached per domain for the session.

## Getting Started

1. Open `index.html` in any modern browser
2. Paste your **OpenAI API key** into the key field
3. Type a question or task and press **Enter** (or click **Send**)
4. Watch the generated code and its output appear in the console area

No build tools, no dependencies — just a single HTML file.

## How It Works

- **System prompt** instructs GPT-4o to respond only with JavaScript in a code block
- **Code extraction** uses regex to pull JS from the markdown response
- **Sandboxed execution** runs code in a disposable `<iframe sandbox="allow-scripts">` — the sandbox has no access to the parent page's DOM, cookies, localStorage, or JS variables
- **Content Security Policy** — the sandbox iframe includes a CSP with `default-src 'none'` and `connect-src https:`. Outbound HTTPS requests (fetch, XHR) are allowed so LLM-generated code can call external APIs; all other resource types are blocked
- **Nonce validation** — each execution gets a `crypto.randomUUID()` nonce to tie results to the correct invocation, preventing stale or replayed postMessage events
- **Conversation history** — maintains a sliding window of up to 20 message pairs with automatic trimming and token-count warnings
- **API key management** detects `YOUR_API_KEY` placeholders and prompts for credentials per domain; the OpenAI key is stored only in a JS variable and the input element is removed from the DOM after first use

## Security

The app executes AI-generated code in a **sandboxed iframe** that is isolated from the parent page:

- ✅ No access to parent DOM, cookies, or localStorage
- ✅ Origin-checked postMessage communication
- ✅ OpenAI API key never exposed to generated code (stored in parent page only)
- ⚠️ **Outbound HTTPS requests are allowed** — the sandbox CSP includes `connect-src https:` so that LLM-generated code can call external APIs (weather, data services, etc.). This is required for the core use case but means code running in the sandbox can make network requests.

### Service API Key Caveat

When you provide an external service API key (e.g., for a weather API), it is injected directly into the sandbox code. Because the sandbox allows outbound HTTPS, a prompt injection attack could theoretically trick the model into generating code that exfiltrates that key. Your **OpenAI** key is safe (it stays in the parent page), but exercise caution with other service keys you provide.

As with any tool that runs AI-generated code, exercise caution with the prompts you send.

## License

MIT
