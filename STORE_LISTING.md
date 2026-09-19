# Store listing copy — Tail MCP

Status: **AMO (Firefox) published** — [tail-mcp](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/), v2.0.10. **Chrome Web Store — still a draft.**

What the AMO listing actually shows (checked 2026-09-19, v2.0.10) differs from the draft copy kept below:

- **Name:** Tail MCP
- **Summary:** `Local MCP server control for Firefox. Open extension options after install for setup steps.` (this is `manifest.json`'s `description` — not the longer summary proposed below)
- **Category:** web-development
- **License:** MIT — **Homepage:** https://github.com/rtf6x/tail-browser-mcp
- **Permissions:** tabs, tabGroups, history, storage, `<all_urls>`, find

Re-check the live listing before editing it; do not assume the text below is what shipped. The draft copy below was rewritten to name harnesses generically (Claude Code, Claude Desktop, OpenCode, omp, any MCP client) — the live AMO listing still carries the older Claude/OpenCode-only wording until it is re-published.

## Chrome Web Store

**Short description** (132 char max — 128 used):
```
Let your AI assistant (Claude, OpenCode, any MCP client) control this browser locally: tabs, history, page reading, screenshots.
```

**Detailed description:**
```
Tail MCP connects an AI assistant running on your machine to this browser, over a local MCP (Model Context Protocol) server you run yourself — no cloud service, no accounts.

WHAT IT DOES
• Tabs — open, close, list, reorder, group
• History — search recent browsing history
• Pages (with your per-domain consent) — read text and links, find/highlight text, scroll to an element, run JavaScript, query the DOM, read console output, take screenshots, resize the viewport to test responsive/mobile layouts
• Runs entirely on your machine — the extension talks only to a local WebSocket server (default 127.0.0.1), never to a Tail MCP cloud backend, because there isn't one

WHY IT'S SAFE BY DEFAULT
• Every page-reading or scripting tool requires your explicit, per-domain approval in the extension's Options page before it can touch a page
• Every tool can be toggled on/off individually
• A local audit log shows every command that ran
• No analytics, no telemetry, no third-party SDKs

WHO IT'S FOR
Developers and power users who want their coding agent (Claude Code, Claude Desktop, OpenCode, or any MCP-compatible client) to inspect real webpages, debug a running app, check responsive layouts, or automate routine browser chores — without giving up control over what it can see or do.

SETUP
1. Install this extension.
2. Run the Tail MCP server on your machine (see github.com/rtf6x/tail-browser-mcp for instructions; Docker one-liner included).
3. Open the extension's Options page, set a Browser ID and the server's WebSocket URL.
4. Point your MCP client (Claude Code, Claude Desktop, OpenCode, omp — any Streamable-HTTP MCP client) at the server.

Open source, MIT licensed: github.com/rtf6x/tail-browser-mcp
```

**Category:** Developer Tools
**Permissions justification (for CWS review form):**
- `tabs`, `tabGroups` — list/open/close/group tabs at the AI assistant's request
- `history` — search browsing history at the AI assistant's request
- `scripting`, host permissions (granted per-domain by the user) — run JS / read DOM content only on domains the user explicitly approved in Options
- `storage` — persist extension settings (Browser ID, tool toggles, consent list, audit log) locally
- `alarms` — periodic WebSocket reconnect attempts
- `offscreen` — maintain a persistent WebSocket connection from a Manifest V3 service worker
- `debugger` — used only by the optional, off-by-default viewport-resize tool to emulate device dimensions via Chrome DevTools Protocol; not used by any other tool

## Firefox (AMO) — published as [tail-mcp](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/) (v2.0.10)

**Summary** (250 char max — used ~200):
```
Tail MCP lets an AI assistant (Claude, Claude Code, OpenCode, omp, or any MCP client) control this browser through a local MCP server you run yourself: tabs, history, and — with your per-domain consent — reading, scripting, and screenshotting pages.
```

**Description:** reuse the Chrome Web Store "Detailed description" above verbatim (AMO has no separate short/long split requirement beyond the summary field).

**Tags:** mcp, ai, automation, developer-tools, claude, agent

**Data collection / privacy form:** select "None" for all categories — the extension collects no data itself; declare the local audit log and settings as browser-local storage only, not "collection." Link `PRIVACY_POLICY.md` (raw GitHub URL) as the privacy policy URL:
```
https://raw.githubusercontent.com/rtf6x/tail-browser-mcp/main/PRIVACY_POLICY.md
```

## Icons

Existing `generate-icons.py` output in `chrome-extension/assets/icons/` already produces 16/32/48/128px PNGs per connection state — sufficient for both stores' icon requirements (Chrome needs 128×128 for the store listing itself; reuse or upscale the connected-state icon for that one asset).
