# Agent Guidelines

- This is a desktop-only Obsidian plugin. Edit TypeScript in `src/`; `main.js` is generated and ignored.
- Preserve the Markdown contract in `src/main.ts`: `## 🔴 REC`, each audio embed followed by its transcription `<details>` block, and `## 🤖 AI`.
- Verify changes with `npm run lint` and `npm run build`; there is no automated test suite.
