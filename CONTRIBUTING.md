# Contributing to Agentic Chat

Thanks for your interest in contributing! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

## Code of Conduct

Be respectful, constructive, and inclusive. We're all here to build something useful.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/agenticchat.git
   cd agenticchat
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

Agentic Chat is a zero-dependency browser application. The core app (`index.html`, `app.js`, `style.css`) requires no build tools — just open `index.html` in a browser.

For running tests:

```bash
npm install          # Install dev dependencies (Jest)
npm test             # Run the test suite
```

### Requirements

- **Node.js** ≥ 18.0.0 (for tests only)
- A modern browser (Chrome, Firefox, Safari, Edge)
- An [OpenAI API key](https://platform.openai.com/api-keys) with GPT-4o access (for manual testing)

## Architecture Overview

The codebase is a single-file application (`app.js`) organized into modules:

| Module | Responsibility |
|---|---|
| `ChatConfig` | Constants and configuration (model, limits, prompts) |
| `ConversationManager` | Chat history management, trimming, token estimation |
| `SandboxRunner` | iframe sandbox creation, code execution, cancellation |
| `ApiKeyManager` | OpenAI key storage, per-service key prompts, modal handling |
| `UIController` | All DOM updates, button state, character counter |
| `ChatController` | Orchestrates message flow, API calls, response processing |

All modules communicate through public APIs. DOM manipulation is isolated to `UIController` except where the sandbox requires direct access.

### Key Files

```
├── index.html          # Entry point — single HTML file
├── app.js              # All application logic (modular architecture)
├── style.css           # Styles
├── tests/
│   ├── setup.js        # Test environment setup (DOM mocks)
│   └── app.test.js     # Jest test suite
├── docs/               # GitHub Pages documentation
├── Dockerfile          # Container build
└── .github/
    └── workflows/      # CI/CD, CodeQL, Docker, Pages, npm publish
```

## Making Changes

### Before You Start

- Check existing [issues](https://github.com/sauravbhattacharya001/agenticchat/issues) to avoid duplicate work
- For large changes, open an issue first to discuss the approach
- Keep changes focused — one feature or fix per PR

### Guidelines

- **Read the code first.** Understand the module structure before modifying.
- **No new runtime dependencies.** The app is intentionally zero-dependency in the browser. Dev dependencies (testing) are fine.
- **Security matters.** Sandbox isolation, CSP headers, and nonce validation are critical. Don't weaken them.
- **Keep it simple.** This is a lightweight tool, not a framework.

## Testing

Tests use **Jest** with **jsdom** environment:

```bash
npm test                    # Run all tests
npx jest --watch            # Watch mode during development
npx jest --coverage         # Generate coverage report
npx jest tests/app.test.js  # Run specific test file
```

### Writing Tests

- Place test files in `tests/` with `.test.js` extension
- Use `tests/setup.js` for shared DOM mocks and fixtures
- Test behavior, not implementation details
- Cover edge cases and error paths, not just happy paths

Example:
```javascript
describe('ConversationManager', () => {
  test('should trim history when exceeding max pairs', () => {
    // Arrange: fill history beyond MAX_HISTORY_PAIRS
    // Act: add one more message
    // Assert: oldest messages were removed
  });
});
```

## Pull Request Process

1. **Ensure tests pass:** `npm test` must succeed
2. **Write descriptive commits:** Use clear, imperative commit messages
   - ✅ `Fix sandbox timeout not clearing on cancel`
   - ✅ `Add input validation for API key format`
   - ❌ `Fixed stuff`
   - ❌ `Update app.js`
3. **Update documentation** if your change affects usage or behavior
4. **Keep PRs small** — easier to review, faster to merge
5. **Fill in the PR template** (if present) with context on what and why

### Review Criteria

- Does it maintain security guarantees (sandbox isolation, CSP, nonce validation)?
- Are there tests for new behavior?
- Does it follow the existing code style?
- Is the change necessary and well-scoped?

## Style Guide

### JavaScript

- Use `'use strict'` (already set globally)
- Use `const` by default, `let` when reassignment is needed, never `var`
- Use descriptive names: `handleUserInput` not `hUI`
- Keep functions focused — one responsibility per function
- Add JSDoc comments for public module APIs
- Use `Object.freeze()` for configuration objects

### CSS

- Use CSS custom properties (variables) for theming values
- Follow existing naming conventions
- Mobile-first: ensure changes work on small screens

### HTML

- Semantic elements where appropriate
- Accessible: labels, ARIA attributes, keyboard navigation

## Reporting Bugs

Open an [issue](https://github.com/sauravbhattacharya001/agenticchat/issues/new) with:

1. **Summary** — One sentence describing the bug
2. **Steps to reproduce** — Exact steps to trigger the problem
3. **Expected behavior** — What should happen
4. **Actual behavior** — What actually happens
5. **Environment** — Browser, OS, any relevant extensions
6. **Screenshots** — If applicable

## Requesting Features

Open an [issue](https://github.com/sauravbhattacharya001/agenticchat/issues/new) with:

1. **Problem statement** — What limitation or need does this address?
2. **Proposed solution** — How would it work from a user perspective?
3. **Alternatives considered** — What else did you think about?
4. **Scope** — Is this a small tweak or a significant change?

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
