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
- **Sandboxed execution** runs the code via `eval()` inside an async wrapper
- **API key management** detects `YOUR_API_KEY` placeholders and prompts for credentials per domain

## Security Note

⚠️ This app executes AI-generated code directly in your browser using `eval()`. Use it in a trusted environment and be cautious with the prompts you send — the generated code has full access to browser APIs.

## License

MIT
