# Architecture — Agentic Chat

> **Last updated:** 2026-04-05

Agentic Chat is a zero-dependency, single-page browser application. All logic lives in `app.js` as self-contained IIFE modules (110+). There is no build step, no framework, and no server — just vanilla JavaScript running in the browser.

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────┐
│  index.html  (CSP headers, single-page UI)              │
│  style.css   (responsive dark theme)                     │
├─────────────────────────────────────────────────────────┤
│  app.js — Module layers (bottom → top):                  │
│                                                          │
│  ┌── Infrastructure ──────────────────────────────────┐ │
│  │ SafeStorage · DOMCache · ToastManager              │ │
│  │ ChatOutputObserver · PanelRegistry · ChatConfig    │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Core Chat ───────────────────────────────────────┐ │
│  │ ConversationManager · SandboxRunner · ApiKeyManager│ │
│  │ OpenAIClient · UIController · ChatController       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Session Management ──────────────────────────────┐ │
│  │ SessionManager · ConversationSessions · CrossTabSync│ │
│  │ SessionNotes · SessionArchive · SessionCalendar    │ │
│  │ SessionTemplates                                    │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Search & Navigation ─────────────────────────────┐ │
│  │ MessageSearch · GlobalSessionSearch · ChatBookmarks │ │
│  │ SlashCommands · CommandPalette · QuickSwitcher      │ │
│  │ ConversationTimeline · SmartScroll                  │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Content & Messages ──────────────────────────────┐ │
│  │ MessageReactions · MessagePinning · MessageEditor   │ │
│  │ MessageAnnotations · MessageDiff · MessageDiffViewer│ │
│  │ MessageTranslator · MessageFilter · MessageScheduler│ │
│  │ MessageContextMenu · MessageHighlighter             │ │
│  │ MessageReaderView · ReadAloud                       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Productivity ────────────────────────────────────┐ │
│  │ PromptTemplates · PromptLibrary · SnippetLibrary   │ │
│  │ QuickReplies · FormattingToolbar · Scratchpad      │ │
│  │ InputHistory · FileDropZone · FocusMode · FocusTimer│ │
│  │ TextExpander · SmartPaste · DraftRecovery          │ │
│  │ PromptChainRunner · PromptABTester · SmartRetry    │ │
│  │ ClipboardHistory · ConversationStash               │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Analytics & Insights ────────────────────────────┐ │
│  │ ChatStats · CostDashboard · UsageHeatmap           │ │
│  │ ContextWindowMeter · ResponseTimeBadge             │ │
│  │ TypingSpeedMonitor · StreakTracker · MoodTracker   │ │
│  │ ReadabilityAnalyzer · ConversationSentiment        │ │
│  │ ConversationHealthCheck                             │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Conversation Tools ──────────────────────────────┐ │
│  │ ConversationFork · ConversationMerge               │ │
│  │ ConversationReplay · ConversationSummarizer        │ │
│  │ ConversationChapters · ConversationTags · AutoTagger│ │
│  │ ConversationAgenda · ConversationMindMap            │ │
│  │ ConversationFlashcards · ConversationExport        │ │
│  │ ConversationShareLink · ConversationTimer          │ │
│  │ ConversationScreenshot                              │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Theming & UI ────────────────────────────────────┐ │
│  │ ThemeManager · CustomThemeCreator · PersonaPresets  │ │
│  │ ModelSelector · ModelCompare · ModelComparePanel    │ │
│  │ SplitView · PinBoard · EmojiPicker                 │ │
│  │ TypingIndicatorBubble · SmartTitle                  │ │
│  │ PreferencesPanel · ResponseLengthPresets            │ │
│  │ ToneAdjuster                                        │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── I/O & Integration ──────────────────────────────┐ │
│  │ VoiceInput · VoiceChatMode · DataBackup            │ │
│  │ ChatGPTImporter · PdfExport · NotificationSound    │ │
│  │ AmbientSoundPlayer · IncognitoMode · ApiInspector  │ │
│  │ OfflineManager (service worker) · WordCloud(s)     │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌── Keyboard & Shortcuts ────────────────────────────┐ │
│  │ KeyboardShortcuts · ResponseRating                  │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Module Pattern

Every module follows the same pattern:

```javascript
const ModuleName = (() => {
  // private state
  let _cache = new Map();

  // private functions
  function _helper() { ... }

  // public API
  return {
    init() { ... },
    doSomething(arg) { ... },
  };
})();
```

Modules communicate through:
1. **Direct calls** — e.g., `ChatController` calls `OpenAIClient.streamChat()`
2. **DOM events** — custom events on `document` for loose coupling
3. **localStorage** — shared state via `SafeStorage` wrapper

## Key Data Flows

### Send Message
```
User input → ChatController.send()
  → ConversationManager.addMessage('user', text)
  → OpenAIClient.streamChat(messages)
  → SandboxRunner.execute(extractedCode)
  → UIController.appendOutput(result)
```

### Session Persistence
```
SessionManager.save()
  → SafeStorage.setJSON('agenticchat_sessions', data)
  → CrossTabSync.broadcast('session-updated')
```

## Storage Keys

All localStorage keys are prefixed with `agenticchat_`:

| Key | Module | Purpose |
|-----|--------|---------|
| `agenticchat_sessions` | SessionManager | All conversation sessions |
| `agenticchat_snippets` | SnippetLibrary | Saved code snippets |
| `agenticchat_bookmarks` | ChatBookmarks | Bookmarked messages |
| `agenticchat_theme` | ThemeManager | Current theme name |
| `agenticchat_prefs` | PreferencesPanel | User preferences |
| `agenticchat_drafts` | DraftRecovery | Unsent draft messages |
| `agenticchat_streak` | StreakTracker | Usage streak data |

## Security Model

1. **Sandbox isolation** — Generated code runs in `<iframe sandbox="allow-scripts">` with strict CSP
2. **Nonce validation** — `crypto.randomUUID()` per execution prevents message replay
3. **CSP headers** — Main page restricts to `'self'` + `api.openai.com`
4. **Key sanitization** — `sanitizeKeyForCodeInjection()` escapes injection vectors
5. **SafeStorage** — All localStorage access wrapped in try/catch for corrupted data

## Testing

```bash
npm ci                    # install deps
npx jest --verbose        # run tests
npx jest --coverage       # with coverage report
```

Tests live in `tests/app.test.js` using `jest-environment-jsdom`. The test setup (`tests/setup.js`) loads `app.js` into a simulated DOM and exposes all modules globally.

## Files

| File | Purpose |
|------|---------|
| `app.js` | All application logic (110+ IIFE modules, ~32k lines) |
| `index.html` | Single-page UI with CSP meta tags |
| `style.css` | Responsive dark-theme stylesheet |
| `sw.js` | Service worker for offline/PWA support |
| `manifest.json` | PWA manifest |
| `tests/` | Jest test suite |
| `docs/` | GitHub Pages documentation site |
| `Dockerfile` | Multi-stage container build |
| `scripts/stamp-sw.js` | Build script to version-stamp the service worker |
