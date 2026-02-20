<div align="center">

# 🤖 Agentic Chat

**Turn natural language into executable code — right in your browser.**

[![Azure Static Web Apps CI/CD](https://github.com/sauravbhattacharya001/agenticchat/actions/workflows/azure-static-web-apps-gray-forest-0f6217910.yml/badge.svg)](https://github.com/sauravbhattacharya001/agenticchat/actions/workflows/azure-static-web-apps-gray-forest-0f6217910.yml)
[![CodeQL](https://github.com/sauravbhattacharya001/agenticchat/actions/workflows/codeql.yml/badge.svg)](https://github.com/sauravbhattacharya001/agenticchat/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sauravbhattacharya001/agenticchat/blob/main/LICENSE)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#tech-stack)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](#tech-stack)
[![OpenAI](https://img.shields.io/badge/Powered%20by-GPT--4o-412991?logo=openai&logoColor=white)](https://platform.openai.com/)
[![GitHub repo size](https://img.shields.io/github/repo-size/sauravbhattacharya001/agenticchat)](https://github.com/sauravbhattacharya001/agenticchat)
[![GitHub last commit](https://img.shields.io/github/last-commit/sauravbhattacharya001/agenticchat)](https://github.com/sauravbhattacharya001/agenticchat/commits/main)
[![codecov](https://codecov.io/gh/sauravbhattacharya001/agenticchat/graph/badge.svg)](https://codecov.io/gh/sauravbhattacharya001/agenticchat)

A lightweight, zero-dependency chat interface that sends your prompts to GPT-4o, extracts the JavaScript it writes, and executes it in a sandboxed iframe — all from a single HTML file.

[**Live Demo**](https://sauravbhattacharya001.github.io/agenticchat/) · [**Report Bug**](https://github.com/sauravbhattacharya001/agenticchat/issues) · [**Request Feature**](https://github.com/sauravbhattacharya001/agenticchat/issues)

</div>

---

## ✨ Features

- **Natural Language → Code** — Ask a question or describe a task in plain English; GPT-4o returns JavaScript that gets executed automatically
- **Sandboxed Execution** — Generated code runs in an `<iframe sandbox="allow-scripts">` with no access to the parent page's DOM, cookies, localStorage, or variables
- **Content Security Policy** — The sandbox iframe enforces `default-src 'none'; connect-src https:` so code can call external APIs but nothing else
- **Nonce Validation** — Each execution gets a `crypto.randomUUID()` nonce to prevent stale or replayed postMessage events
- **Conversation History** — Maintains a sliding window of up to 20 message pairs with automatic trimming and token-count warnings; viewable in a side panel with Markdown/JSON export
- **Prompt Templates** — Built-in library of categorized prompt templates (data visualization, web APIs, utilities, creative) with search filtering
- **Snippet Library** — Save, tag, search, rename, and re-run generated code snippets; persisted to localStorage
- **API Key Management** — Detects `YOUR_API_KEY` placeholders in generated code and prompts for credentials per domain; keys are cached per session
- **Input Guardrails** — Character limit (50K chars), total token estimate warnings (~80K threshold), and real-time character counter
- **Cancel Execution** — Stop long-running sandbox code with a single click
- **Zero Dependencies** — Single HTML file + CSS + JS. No build tools, no npm, no bundler. Just open and go.

## 🚀 Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- An [OpenAI API key](https://platform.openai.com/api-keys) with GPT-4o access

### Usage

1. **Open** `index.html` in your browser — or visit the [live demo](https://sauravbhattacharya001.github.io/agenticchat/)
2. **Paste** your OpenAI API key into the key field (stored in memory only, never persisted)
3. **Type** a question or task and press **Enter**
4. **Watch** the generated code and its output appear in the console area

```text
> "What's the current UTC time?"
→ GPT-4o generates: return new Date().toUTCString();
→ Output: Fri, 14 Feb 2026 10:00:00 GMT

> "Fetch the top Hacker News story"
→ GPT-4o generates fetch() code targeting the HN API
→ Output: { title: "...", url: "..." }
```

## 🏗️ How It Works

```
User Prompt  →  GPT-4o (system prompt: reply with JS only)
                    ↓
             Markdown response with ```js code block
                    ↓
             Regex extraction of JavaScript
                    ↓
             Sandboxed iframe execution
                    ↓
             postMessage with nonce-validated result
                    ↓
             Display output in console area
```

1. A **system prompt** instructs GPT-4o to respond exclusively with JavaScript in a fenced code block
2. The app **extracts** the code using regex and delivers it to a sandboxed iframe via `postMessage` (not template interpolation — preventing script-tag injection)
3. The iframe **executes** the code with `new Function()` inside an async wrapper
4. Results are **returned** via `postMessage` with origin validation (`'null'` for sandboxed iframes) and nonce matching

### Modules

The codebase is organized into **nine** IIFE modules in `app.js`:

| Module | Purpose |
|--------|---------|
| `ChatConfig` | Frozen constants (model, limits, timeouts, system prompt) |
| `ConversationManager` | Message history with sliding window trimming and token estimation |
| `SandboxRunner` | Iframe sandbox lifecycle, execution, timeout, cancellation |
| `ApiKeyManager` | OpenAI + per-service key storage, substitution, validation |
| `UIController` | All DOM manipulation — button states, modals, output |
| `ChatController` | Orchestrates send flow: input → API → code extraction → sandbox |
| `PromptTemplates` | Browseable template library with search and category filtering |
| `HistoryPanel` | Conversation viewer with Markdown/JSON export |
| `SnippetLibrary` | Save, tag, search, rename, and re-run code snippets (localStorage) |

## 🔒 Security Model

The app executes AI-generated code, so security is a first-class concern:

| Layer | Protection |
|-------|-----------|
| **Iframe Sandbox** | `sandbox="allow-scripts"` — no DOM access, no cookies, no localStorage, no same-origin |
| **CSP** | `default-src 'none'; connect-src https:` — only outbound HTTPS allowed |
| **Origin Check** | postMessage validated against `'null'` origin (sandboxed iframe) |
| **Nonce** | `crypto.randomUUID()` ties each execution to its result, preventing replay |
| **Code Delivery** | Code sent via postMessage, not embedded in HTML (prevents `</script>` injection) |
| **API Key Isolation** | OpenAI key stored in parent JS variable only — never exposed to sandbox |

### ⚠️ Known Limitations

- **Outbound HTTPS is allowed** — The sandbox CSP includes `connect-src https:` so LLM-generated code can call external APIs. This is required for the core use case but means sandbox code can make network requests.
- **Service API keys are injectable** — When you provide a third-party API key (e.g., weather API), it's injected into sandbox code. A prompt injection attack could theoretically exfiltrate it. Your OpenAI key is safe (parent page only).

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | Vanilla HTML5 + CSS + JavaScript (single file) |
| **AI Model** | OpenAI GPT-4o via REST API |
| **Sandbox** | HTML5 iframe sandbox with CSP |
| **Hosting** | GitHub Pages |
| **CI/CD** | GitHub Actions |
| **Security** | CodeQL analysis |

## 📁 Project Structure

```
agenticchat/
├── index.html              # Single-page UI with CSP headers
├── app.js                  # All application logic (modular IIFEs)
├── style.css               # Responsive dark-theme styling
├── package.json            # npm metadata + test scripts
├── jest.config.js          # Jest test configuration
├── Dockerfile              # Multi-stage container build
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
├── README.md               # This file
├── docs/
│   └── index.html          # API reference & architecture docs (GitHub Pages)
├── tests/
│   ├── setup.js            # DOM mocking & app.js loader for jsdom
│   └── app.test.js         # 90+ unit & integration tests
└── .github/
    ├── copilot-instructions.md    # Copilot coding agent context
    ├── copilot-setup-steps.yml    # Copilot agent setup workflow
    ├── dependabot.yml             # Automated dependency updates
    ├── labeler.yml                # Auto-label configuration
    ├── PULL_REQUEST_TEMPLATE.md   # PR template
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.yml         # Bug report form
    │   ├── feature_request.yml    # Feature request form
    │   └── config.yml             # Issue template config
    └── workflows/
        ├── ci.yml                 # Build + test + lint
        ├── codeql.yml             # CodeQL security scanning
        ├── docker.yml             # Docker build & push
        ├── labeler.yml            # Auto-labeler workflow
        ├── pages.yml              # GitHub Pages deployment
        ├── publish.yml            # npm package publishing
        └── stale.yml              # Stale issue/PR management
```

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to your branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Guidelines

- This is a **single-file app** — keep it that way unless there's a compelling reason to split
- Security is paramount — any change that touches the sandbox must be reviewed carefully
- Test with various prompt types before submitting (simple questions, API calls, error cases)

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

**Built by [Saurav Bhattacharya](https://github.com/sauravbhattacharya001)**

</div>
