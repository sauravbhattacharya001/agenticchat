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

### Core
- **Natural Language → Code** — Ask a question or describe a task in plain English; GPT-4o returns JavaScript that gets executed automatically
- **Sandboxed Execution** — Generated code runs in an `<iframe sandbox="allow-scripts">` with no access to the parent page's DOM, cookies, localStorage, or variables
- **Content Security Policy** — The sandbox iframe enforces `default-src 'none'; connect-src https:` so code can call external APIs but nothing else
- **Nonce Validation** — Each execution gets a `crypto.randomUUID()` nonce to prevent stale or replayed postMessage events
- **Multi-Model Support** — Switch between GPT-4o, GPT-4o-mini, GPT-4-turbo, and more via the model selector
- **API Key Management** — Detects `YOUR_API_KEY` placeholders in generated code and prompts for credentials per domain; keys are cached per session

### Conversation Management
- **Conversation History** — Maintains a sliding window of up to 20 message pairs with automatic trimming and token-count warnings
- **Multi-Session** — Create, switch between, rename, and delete multiple conversation sessions with auto-save
- **Cross-Tab Sync** — Detects concurrent edits across browser tabs via BroadcastChannel
- **Conversation Fork** — Branch conversations from any message into new sessions
- **Chapters** — Insert named section dividers with a table-of-contents sidebar
- **Tags** — Colored tag labels on sessions with filtering and management
- **Auto-Tagger** — Heuristic topic detection and automatic tag suggestions

### Search & Navigation
- **Message Search** — Full-text search across conversation messages with highlighting
- **Global Session Search** — Search across all saved sessions at once
- **Conversation Timeline** — Visual minimap sidebar for conversation navigation
- **Bookmarks & Pinning** — Bookmark messages for quick reference; pin important ones to a floating bar
- **Slash Commands** — `/`-triggered command dropdown with autocomplete and keyboard navigation

### Productivity
- **Prompt Templates** — Built-in library of categorized prompt templates with search filtering
- **Snippet Library** — Save, tag, search, rename, and re-run generated code snippets
- **Quick Replies** — Contextual follow-up suggestion chips after AI responses
- **Formatting Toolbar** — Markdown formatting buttons above the chat input
- **Scratchpad** — Persistent notepad panel with copy/insert/download actions
- **Input History** — Navigate previous prompts with ↑/↓ arrow keys
- **File Drop Zone** — Drag-and-drop file inclusion (text-based files, 100 KB limit)
- **Focus Mode** — Distraction-free zen mode (Ctrl+Shift+F)

### Analysis & Insights
- **Chat Stats** — Conversation analytics: word counts, code blocks, response timing
- **Cost Dashboard** — Persistent API spend tracker with budget alerts and daily chart
- **Message Diff** — Compare any two messages with visual line-level diff
- **Conversation Summarizer** — Heuristic summary with topics, decisions, and action items
- **Response Time Badge** — Per-response latency indicator

### Personalization
- **Persona Presets** — Switchable system prompt presets with custom persona support
- **Theme Manager** — Dark/light theme with OS preference detection
- **Keyboard Shortcuts** — Global shortcuts with help modal
- **Voice Input** — Browser speech recognition with language selection
- **Read Aloud** — Text-to-speech for messages with voice/speed controls

### Data
- **Message Annotations** — Private notes/annotations on messages with labels
- **Message Reactions** — Per-message emoji reactions with persistent counts
- **Data Backup** — Full backup/restore for all 21 data keys (export/import/selective/merge)
- **Zero Dependencies** — Single HTML file + CSS + JS. No build tools, no npm, no bundler. Just open and go.
- **Input Guardrails** — Character limit (50K chars), token estimate warnings (~80K threshold), real-time counter

### AI & Reliability
- **Response Rating** — Thumbs up/down ratings on AI responses with model satisfaction dashboard
- **Smart Retry** — Automatic retry with exponential backoff for transient API failures
- **Message Editor** — Edit and resend user messages (truncates history and reloads into input)
- **Message Translator** — Inline message translation to 20+ languages via OpenAI API
- **Conversation Merge** — Combine 2+ sessions into one merged conversation with chronological interleaving
- **Conversation Replay** — Message-by-message playback with transport controls (play/pause/speed)
- **Prompt Library** — User-created prompt snippets with folders, search, usage tracking, import/export
- **Usage Heatmap** — GitHub-style 7x24 activity heatmap across all sessions

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

The codebase is organized into **49** IIFE modules in `app.js`, each using the revealing-module pattern:

<details>
<summary><strong>Core (7 modules)</strong></summary>

| Module | Purpose |
|--------|---------|
| `SafeStorage` | Safe localStorage wrapper for restricted-storage environments |
| `ChatConfig` | Frozen constants — model list, pricing, token limits, system prompt |
| `ConversationManager` | Message history with sliding window trimming and token estimation |
| `SandboxRunner` | Iframe sandbox lifecycle, execution, timeout, cancellation |
| `ApiKeyManager` | OpenAI + per-service key storage, substitution, validation |
| `UIController` | All DOM manipulation — button states, modals, output |
| `ChatController` | Orchestrates send flow: input → API → code extraction → sandbox |

</details>

<details>
<summary><strong>Features (42 modules)</strong></summary>

| Module | Purpose |
|--------|---------|
| `PromptTemplates` | Categorized prompt library with search and one-click insert |
| `HistoryPanel` | Slide-out conversation history with Markdown/JSON export/import |
| `SnippetLibrary` | Persistent code snippet storage with tagging and search |
| `MessageSearch` | Full-text search across conversation messages |
| `ChatBookmarks` | Bookmark individual messages for quick reference |
| `SlashCommands` | Slash-command dropdown with autocomplete and keyboard nav |
| `MessageReactions` | Per-message emoji reactions with persistent counts |
| `KeyboardShortcuts` | Global keyboard shortcuts with help modal |
| `VoiceInput` | Browser speech recognition with language selection |
| `ThemeManager` | Dark/light theme with OS preference detection |
| `SessionManager` | Multi-session persistence with auto-save and quota management |
| `CrossTabSync` | Multi-tab conflict detection via storage events + BroadcastChannel |
| `ChatStats` | Conversation analytics (word counts, code blocks, timing) |
| `CostDashboard` | Persistent API spend tracker with budget alerts and daily chart |
| `PersonaPresets` | Switchable system prompt presets with custom persona support |
| `ModelSelector` | Model picker with localStorage persistence |
| `FileDropZone` | Drag-and-drop file inclusion (text-based files, 100 KB limit) |
| `FocusMode` | Distraction-free zen mode (Ctrl+Shift+F) |
| `InputHistory` | Navigate previous prompts with ↑/↓ arrow keys |
| `Scratchpad` | Persistent notepad panel with copy/insert/download actions |
| `ResponseTimeBadge` | Response time indicator below token usage area |
| `ConversationFork` | Branch conversations from any message into new sessions |
| `QuickReplies` | Contextual follow-up suggestion chips after AI responses |
| `MessagePinning` | Pin important messages to a floating quick-jump bar |
| `ReadAloud` | Text-to-speech for messages with voice/speed controls |
| `MessageDiff` | Compare any two messages with visual line-level diff |
| `ConversationTimeline` | Visual minimap sidebar for conversation navigation |
| `ConversationSummarizer` | Heuristic conversation summary with topics and action items |
| `MessageAnnotations` | Private notes/annotations on messages with labels |
| `ConversationChapters` | Named section dividers with TOC navigation |
| `ConversationTags` | Colored tag labels on sessions with filtering and management |
| `FormattingToolbar` | Markdown formatting buttons above chat input |
| `GlobalSessionSearch` | Full-text search across all saved sessions |
| `AutoTagger` | Heuristic topic detection and automatic tag suggestions |
| `DataBackup` | Full backup/restore for all user data (21 keys, export/import) |
| `ResponseRating` | Thumbs up/down ratings on AI responses with model satisfaction dashboard |
| `ConversationMerge` | Combine 2+ sessions into one merged conversation (chronological interleave) |
| `ConversationReplay` | Message-by-message playback with transport controls |
| `PromptLibrary` | User-created prompt snippets with folders, search, usage tracking, import/export |
| `MessageTranslator` | Inline message translation to 20+ languages via OpenAI API |
| `MessageEditor` | Edit and resend user messages (truncate history + reload into input) |
| `SmartRetry` | Automatic retry with exponential backoff for transient API failures |
| `UsageHeatmap` | GitHub-style 7x24 activity heatmap across all sessions |
| `SmartPaste` | Intelligent paste formatting — auto-detects JSON, code, CSV, SQL, URLs, stack traces |

</details>

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
├── app.js                  # All application logic (48 modular IIFEs)
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
│   ├── setup.js                  # DOM mocking & app.js loader for jsdom
│   ├── app.test.js               # Core module tests (800+)
│   ├── annotations.test.js       # MessageAnnotations tests
│   ├── auto-tagger.test.js       # AutoTagger tests
│   ├── chapters.test.js          # ConversationChapters tests
│   ├── conversation-merge.test.js # ConversationMerge tests
│   ├── conversation-replay.test.js # ConversationReplay tests
│   ├── conversation-tags.test.js # ConversationTags tests
│   ├── cost-dashboard.test.js    # CostDashboard tests
│   ├── data-backup.test.js       # DataBackup tests
│   ├── formatting-toolbar.test.js # FormattingToolbar tests
│   ├── message-editor.test.js    # MessageEditor tests
│   ├── message-translator.test.js # MessageTranslator tests
│   ├── messagediff.test.js       # MessageDiff tests
│   ├── model-compare.test.js     # ModelCompare tests
│   ├── modules.test.js           # Module existence/integration tests
│   ├── pinning.test.js           # MessagePinning tests
│   ├── prompt-library.test.js    # PromptLibrary tests
│   ├── readaloud.test.js         # ReadAloud tests
│   ├── response-rating.test.js   # ResponseRating tests
│   ├── smart-retry.test.js       # SmartRetry tests
│   ├── summarizer.test.js        # ConversationSummarizer tests
│   ├── timeline.test.js          # ConversationTimeline tests
│   └── usageHeatmap.test.js      # UsageHeatmap tests
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

## 🌐 Browser Compatibility

| Browser | Version | Status | Notes |
|---------|---------|--------|-------|
| Chrome | 90+ | ✅ Full | Recommended — best sandbox + speech API support |
| Firefox | 88+ | ✅ Full | Voice input requires `media.navigator.enabled` |
| Safari | 15+ | ✅ Full | Minor speech recognition differences |
| Edge | 90+ | ✅ Full | Chromium-based, same as Chrome |
| Opera | 76+ | ✅ Full | Chromium-based |
| Mobile Chrome | 90+ | ⚠️ Partial | Voice input may require user gesture; layout adapts |
| Mobile Safari | 15+ | ⚠️ Partial | `sandbox` iframe works but some CSP edge cases exist |

**Requirements:** All browsers must support `crypto.randomUUID()` (HTTPS or localhost only), `iframe sandbox`, and `BroadcastChannel`. No polyfills needed for modern browsers.

## ❓ Troubleshooting

<details>
<summary><strong>"Failed to fetch" or network errors when sending prompts</strong></summary>

- Verify your OpenAI API key is valid and has GPT-4o access
- Check that your API key has sufficient credits/quota
- Ensure you're not behind a corporate proxy that blocks `api.openai.com`
- Try switching to a different model (e.g., GPT-4o-mini) in the model selector

</details>

<details>
<summary><strong>Generated code doesn't execute / "Sandbox error"</strong></summary>

- The sandbox iframe blocks DOM access by design — code that references `document`, `window.location`, or `localStorage` will fail
- Code can only make outbound HTTPS requests (`connect-src https:`)
- Check the browser console for CSP violation messages
- If you see timeout errors, the generated code may be stuck in an infinite loop

</details>

<details>
<summary><strong>Voice input not working</strong></summary>

- Speech recognition requires HTTPS (or localhost) — it won't work over plain HTTP
- Firefox: ensure `media.navigator.enabled` is `true` in `about:config`
- Safari: grant microphone permission when prompted
- Some browsers require a user gesture (click) to activate the microphone

</details>

<details>
<summary><strong>Data lost between sessions</strong></summary>

- All data is stored in `localStorage` — clearing browser data will erase it
- Use the **Data Backup** feature (Settings → Backup) to export your data regularly
- `localStorage` has a ~5 MB limit per origin — the quota indicator in Settings shows usage
- Cross-tab sync uses `BroadcastChannel`; if you edit in two tabs simultaneously, the last write wins

</details>

<details>
<summary><strong>Cost dashboard shows unexpected charges</strong></summary>

- The cost tracker estimates based on token counts and published OpenAI pricing
- Actual billing may differ slightly due to system prompt tokens and retry attempts
- Reset the tracker via Settings → Cost Dashboard → Reset
- Set a budget alert threshold to get warnings before hitting your limit

</details>

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to your branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Guidelines

- This is a **single-file app** — keep it that way unless there's a compelling reason to split
- All 49 modules live in `app.js` as revealing-module IIFEs
- Security is paramount — any change that touches the sandbox must be reviewed carefully
- Test with various prompt types before submitting (simple questions, API calls, error cases)

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

**Built by [Saurav Bhattacharya](https://github.com/sauravbhattacharya001)**

</div>
