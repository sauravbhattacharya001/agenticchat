# Copilot Instructions — Agentic Chat

## Project Overview

Agentic Chat is a lightweight browser-based chat interface that turns natural language prompts into executable JavaScript, powered by OpenAI GPT-4o. It runs entirely in the browser with no backend server.

## Architecture

The app uses a modular IIFE (Immediately Invoked Function Expression) pattern in a single `app.js` file:

- **ChatConfig** — Frozen constants (model name, token limits, timeouts)
- **ConversationManager** — Message history management (add, trim, clear, token estimation)
- **SandboxRunner** — Creates sandboxed iframes to execute AI-generated JavaScript safely
- **ApiKeyManager** — Handles OpenAI API key and per-service key storage/substitution
- **UIController** — All DOM manipulation (button states, modals, output display)
- **ChatController** — Orchestrates the send flow: user input → OpenAI API → code extraction → sandbox execution

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | All application logic (modular IIFEs) |
| `index.html` | Single-page UI with CSP headers |
| `style.css` | Styling |
| `tests/app.test.js` | Jest tests (jsdom environment) |
| `jest.config.js` | Jest configuration |
| `package.json` | Dependencies (jest, jsdom for testing) |

## Conventions

- **No frameworks** — vanilla JavaScript only, no React/Vue/etc.
- **Module pattern** — each concern is an IIFE returning a public API object
- **No `innerHTML` for user/AI content** — use `textContent` or the sanitized `setChatOutputHTML` path
- **CSP enforced** — Content Security Policy in both `index.html` meta tag and sandbox iframe
- **API key validation** — OpenAI keys must match `sk-` prefix pattern
- **Service key injection** — keys are sanitized before code substitution to prevent XSS

## Security Considerations

- Sandbox iframes use `sandbox="allow-scripts"` with CSP `default-src 'none'; script-src 'unsafe-inline'; connect-src https:`
- The main page CSP restricts sources to `'self'` and `https://api.openai.com`
- API key format validation prevents injection via the key input
- `sanitizeKeyForCodeInjection()` escapes quotes, backticks, backslashes, and newlines

## Testing

```bash
# Install test dependencies
npm ci

# Run all tests
npx jest --verbose

# Run with coverage
npx jest --coverage
```

Tests use `jest-environment-jsdom` to simulate the browser DOM. Test files are in `tests/`.

## How to Make Changes

1. All app logic is in `app.js` — modify the relevant module (e.g., `SandboxRunner` for execution changes)
2. Keep the IIFE pattern — don't convert to ES modules (no bundler)
3. Add tests in `tests/app.test.js` for any new logic
4. Ensure CSP headers remain restrictive — don't add `unsafe-eval` or wildcard sources
5. Run `npx jest --verbose` to verify tests pass before committing
