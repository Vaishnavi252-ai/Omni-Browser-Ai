# OmniBrowser AI (Chrome Extension)

On-device, privacy-first multi-tab semantic search + local RAG (Retrieval-Augmented Generation) using **WebGPU**.

This extension:
- Continuously harvests readable text from web pages you visit (content script)
- Builds a local semantic index (Orama)
- Runs an offline LLM locally in an **MV3 Offscreen Document** via **@mlc-ai/web-llm**
- Provides a side panel UI with chat, citations, and local-memory controls

> **Core goal:** answer questions about your *open tabs* without sending content to any external server.

---

## Features

- **Offline-first Local RAG**
  - Retrieval from a local vector index (Orama)
  - Generation using a local WebGPU LLM (MLC)
- **Multi-tab context selection**
  - The side panel lists all active normal-window HTTP(S) tabs
  - You can select which tab sources feed the inference context
- **Citations (clickable source chips)**
  - Answers include citations tied to the pages used as sources
  - Clicking a citation re-opens the cited URL in an active tab
- **Engine lifecycle controls**
  - Engine compile/load progress streamed to the UI
  - Reset offscreen runtime when the engine fails
- **Local memory management**
  - Wipe local Orama cache + reset runtime state
- **Persistent chat history**
  - Chat transcript is stored in `chrome.storage.local` and restored on UI reload

---

## Architecture

### Components

1. **Side panel (React UI)**
   - `src/sidepanel/App.tsx`
   - Provides chat UI, tab-source selection, status display, and memory controls

2. **Background service worker (orchestrator)**
   - `src/background/index.ts`
   - Maintains tab context matrix updates
   - Creates the offscreen document on demand
   - Scrapes selected tab text for inference and forwards requests to offscreen

3. **Offscreen document (local runtime)**
   - `src/offscreen/index.html`
   - `src/offscreen/offscreen.ts`
   - Hosts the Orama index + local WebGPU LLM
   - Handles ingestion, retrieval, prompting, and inference

4. **Content script (text extraction + ingestion triggers)**
   - `src/content/index.ts`
   - Extracts paragraph-like blocks from the current page and sends them to the runtime

---

## How it works

### 1) Tab context “pulse” (background)

The background listens to:
- `chrome.tabs.onActivated`
- `chrome.tabs.onUpdated`

When a tab becomes active or finishes loading, it queries all normal window tabs and sends:
- `MATRIX_CONTEXT_PULSE`

to the side panel, including:
- total tabs
- indexed (HTTP) tabs count
- metadata list: `{ id, title, url }`

### 2) Content ingestion (content script)

When the content script runs at `document_idle`, it:
1. Reads `document.body.innerText`
2. Splits into paragraph-like blocks
3. Filters blocks to keep only “substantial” content
4. Sends a message:
   - `TAB_SCRAPED_DATA`
   - `{ url, title, chunks: paragraphs }`

to the extension runtime.

### 3) Local indexing (offscreen)

In the offscreen document, `TAB_SCRAPED_DATA`:
- normalizes chunk strings
- maps chunks into Orama documents: `{ text, url, title }`
- inserts them into the local Orama index

### 4) Inference request flow (UI → background → offscreen)

When the user clicks **RUN ⚡** in the side panel:
1. The UI sends `RUN_LOCAL_INFERENCE` to the background:
   - `query: user prompt`
   - `targetTabIds: selected tabs` (from the matrix list)
2. The background:
   - ensures the offscreen document exists (creates it if needed)
   - scrapes `innerText` from the selected tab IDs
   - compiles a “context matrix” text for the selected sources
   - forwards to offscreen as `RUN_INFERENCE_OFFSCREEN`

3. The offscreen runtime handles `RUN_LOCAL_INFERENCE(_OFFSCREEN)` by:
   - Ensuring Orama DB is initialized
   - Ensuring the WebGPU LLM engine is compiled/ready
   - Building a prompt
     - Uses supplied `context` if present
     - Otherwise uses Orama retrieval (`search(db, term, limit: 10)`) and ranks hits based on active tab similarity
   - Running the LLM prompt
   - Returning:
     - `INFERENCE_COMPLETE_RESPONSE` with `answer` and `citations`

### 5) Citations & context ranking

Citations are deduped by a composite key:
- `title + url` (lowercased)

If retrieval is used, hits are ranked using heuristics:
- title exact match
- title substring match
- same hostname
- exact URL match

---

## Prompting & audit mode

### Default mode

The offscreen runtime instructs the model to:
- answer using only the supplied context
- clearly state when context is insufficient

### Audit mode

If `auditMode` is enabled in the message, the runtime switches the prompt to:
- analyze for logical fallacies, clickbait formatting, media bias, and signs of synthesis loops
- output a raw JSON scorecard:

```json
{ "biasScore": 1-100, "dominantFallacy": "string", "determination": "string" }
```

---

## UX behavior (side panel)

Tabs:
- **Chat Workspace**
  - Shows a persistent transcript
  - Shows engine compile status and progress
  - Displays answer text and citations

- **Data Hub Matrix**
  - Renders each tab as a checkbox (selected sources)

- **Engine Room**
  - Provides a UI action to wipe local memory caches
  - Offers “Low Battery Mode” / “Deep Reasoner” styling (UI-only currently)

Local memory actions:
- **Wipe Local Memory Caches Now**
  - Sends `PURGE_ALL_DATA` to the runtime
  - Clears Orama storage and resets in-memory engine state

---

## Permissions & why they’re used

From `manifest.json`:

- `sidePanel`
  - required to display the extension’s side panel UI

- `tabs`, `activeTab`
  - required to query tab metadata and to activate/route citations

- `scripting`
  - required for background `chrome.scripting.executeScript` to scrape tab text

- `offscreen`
  - required for `chrome.offscreen.createDocument`

- `storage`, `unlimitedStorage`
  - used to persist chat history and allow local storage usage patterns

---

## Model

The offscreen runtime initializes WebGPU LLM via:
- `CreateMLCEngine(targetModel, ...)`

Current target model:
- **`Qwen2-0.5B-Instruct-q4f16_1-MLC`**

During initialization, it emits status updates to the UI via:
- `ENGINE_COMPILE_STATUS`

---

## Message protocol (high level)

### Background ↔ Side panel
- `MATRIX_CONTEXT_PULSE`
  - `{ totalTabsCount, indexedCount, tabsMetadata }`

### Side panel → Background
- `RUN_LOCAL_INFERENCE`
- `PURGE_ALL_DATA`
- `RESET_OFFSCREEN`

### Background → Offscreen
- `RUN_INFERENCE_OFFSCREEN`
- `RUN_PASSIVE_INSIGHT`
- `RUN_AUDIT`
- `PURGE_ALL_DATA`
- `RESET_OFFSCREEN`

### Offscreen → Background (then to UI)
- `ENGINE_COMPILE_STATUS`
- `INFERENCE_COMPLETE_RESPONSE`
- `INFERENCE_ERROR`
- `PURGE_ALL_DATA_SUCCESS`

---

## Project structure

- `manifest.json`
  - MV3 manifest (side panel, content script, CSP, permissions)

- `src/content/index.ts`
  - Content script: extracts page text blocks and sends `TAB_SCRAPED_DATA`

- `src/background/index.ts`
  - Service worker: tab matrix pulse, offscreen creation, request orchestration, tab scraping

- `src/offscreen/index.html`
  - Offscreen document shell

- `src/offscreen/offscreen.ts`
  - Local Orama index + WebGPU LLM engine; ingestion + inference + reset/purge handlers

- `src/sidepanel/index.html`
  - Side panel entry HTML

- `src/sidepanel/App.tsx`
  - React UI

- `src/types/chrome-shim.d.ts`
  - Minimal typed shim for the Chrome extension APIs used by the repo

---

## Development & build

### Requirements

- Node.js (matching your npm lockfile)
- A Chromium-based browser with MV3 extension support
- WebGPU-capable environment for local inference

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build (UI + background + manifest patch)

```bash
npm run build
```

Build steps (from `package.json`):
1. `tsc -b`
2. `vite build --config vite.background.config.ts`
3. `vite build --config vite.config.ts --emptyOutDir false`
4. `node patch-manifest.js`

### Lint

```bash
npm run lint
```

### Preview

```bash
npm run preview
```

---

## How to load the extension

1. Run:
   - `npm run build`
2. Locate the output:
   - `dist/`
3. Load the built folder in `chrome://extensions`
   - Enable **Developer mode**
   - Use **Load unpacked** and point to `dist/`

---

## Troubleshooting

### 1) Offscreen document fails to load

Common causes:
- the `offscreen` permission missing
- the URL entry for offscreen is wrong

Relevant code:
- background ensures a single offscreen context exists via `chrome.runtime.getContexts` and `chrome.offscreen.createDocument`.

### 2) CSP / build issues with background module type

The repo uses a build-time manifest rewrite:
- `vite.background.config.ts` writes `dist/manifest.json`
- `patch-manifest.js` syncs root manifest settings into `dist`

If CSP-related errors occur, verify `manifest.json` and the `extension_pages` CSP.

### 3) WebGPU / model initialization errors

Use the UI:
- watch for `ENGINE_COMPILE_STATUS`
- if inference fails, use **System Reset** (UI error panel)

The runtime can be reset via:
- `RESET_OFFSCREEN`

### 4) No context / low answer quality

This can happen if:
- the content script didn’t index readable blocks yet
- no selected tabs contain enough text

Check:
- whether the side panel shows non-zero “context sources active”
- whether page content is visible and extractable by `innerText`

---

## Notes & security model

- **On-device processing:** indexing and inference run locally in the extension runtime.
- **No server calls are implemented in this repo.**
- The extension scrapes only DOM text (`innerText`) and uses it for retrieval/context.

---

## Contributing

Contributions are welcome.

- Keep the message protocol stable unless you update all components.
- When changing the runtime model, update the target model string in `src/offscreen/offscreen.ts`.

---

## License

Add your project license here (not present in the repository content currently). 

