# NotebookLM Assistant MVP Architecture

## Components
- Background service worker: keyboard shortcut/context-menu entry points and backup downloads.
- Content script: NotebookLM page UI, DOM extraction, merge/backup/delete flow orchestration.
- Popup: quick launcher for quick-add/manager.
- Options page: settings persisted to `chrome.storage.sync`.

## Core flow
1. User opens quick add (floating button / command / popup / context menu).
2. Content script collects input (text/url/clipboard image metadata).
3. Content script tries NotebookLM DOM automation for source addition.
4. On merge/delete, content script scans source cards from DOM, creates markdown backup, and requests download via background.
5. Delete action is enabled only when current target set is included in latest backup set.

## Selector strategy
- All NotebookLM selectors are centralized in `src/selectors/notebooklm.ts`.
- `queryFirstVisible` + text-based fallback are used to reduce breakage risk.

## Known limitations
- Full source body extraction depends on currently rendered DOM; if hidden by virtualization, only visible snippet can be backed up.
- Clipboard image is stored as local backup file; image direct upload to NotebookLM is not guaranteed.
- UI and selectors may break when NotebookLM updates layout.
