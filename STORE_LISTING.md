# Store listing copy — Tail MCP

Status: **AMO (Firefox) published** — [tail-mcp](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/), v2.0.10. **Chrome Web Store — still a draft.**

What the AMO listing actually shows (checked 2026-09-19, v2.0.10) differs from the draft copy kept below:

- **Name:** Tail MCP
- **Summary:** `Local MCP server control for Firefox. Open extension options after install for setup steps.` (this is `manifest.json`'s `description` — not the longer summary proposed below)
- **Category:** web-development
- **License:** MIT — **Homepage:** https://github.com/rtf6x/tail-browser-mcp
- **Permissions:** tabs, tabGroups, history, storage, `<all_urls>`, find

Re-check the live listing before editing it; do not assume the text below is what shipped. The draft copy below was rewritten to name harnesses generically (Claude Code, Claude Desktop, OpenCode, omp, any MCP client) — the live AMO listing still carries the older Claude/OpenCode-only wording until it is re-published.

To replace the AMO **Summary** and **Description**, paste the copy in the "Firefox (AMO)" section below into Developer Hub → *Edit Product Page*. No new version upload is needed: the product page text is independent of the signed XPI, and the summary currently shown is just `manifest.json`'s `description` pulled in at submission time.

## Chrome Web Store

**Short description** (132 char max — 93 used):
```
Let your AI assistant control this browser locally: tabs, history, page reading, screenshots.
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
Developers and power users who want their AI coding agent (any MCP-compatible client) to inspect real webpages, debug a running app, check responsive layouts, or automate routine browser chores — without giving up control over what it can see or do.

SETUP
1. Install this extension.
2. Run the Tail MCP server on your machine (see github.com/rtf6x/tail-browser-mcp for instructions; a prebuilt desktop app and a container image are available).
3. Open the extension's Options page, set a Browser ID and the server's WebSocket URL.
4. Point your MCP client (any Streamable-HTTP MCP client) at the server.

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
- `debugger` — used only by the optional, off-by-default viewport-resize tool to emulate device dimensions via the DevTools protocol; not used by any other tool

## Firefox (AMO) — published as [tail-mcp](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/) (v2.0.10; copy below written, not yet pasted)

**Summary** (250 char max — 222 used):
```
Drive your browser from your AI coding agent through a local MCP server you run yourself: tabs, history, and — with per-domain consent — page reading, scripting and screenshots. Any MCP client; nothing leaves your machine.
```

**Description** (Markdown is supported in this field; `##` headings, lists, bold, links and code spans render):

```
Tail MCP connects an AI assistant running on your own machine to this browser, through a local MCP (Model Context Protocol) server that you run yourself. No cloud service, no account: the extension talks only to a WebSocket server on 127.0.0.1.

**Why not a browser-automation framework?** Those drive a separate, automated browser. Sites that fingerprint bot-controlled browsers — the usual anti-bot and login-walled pages — detect and block it. Tail MCP is a real extension inside your own, already logged-in browser, so to the website the traffic looks exactly like you clicking around. It is: no automation flag, no headless fingerprint, no second profile to authenticate again.

## What the assistant can do

- **Tabs** — list, open, close, reorder and group.
- **History** — search your recent browsing history.
- **Pages**, on the domains you approve — read text and links, find and highlight text, scroll an element into view, query the DOM, run JavaScript, read console output, take screenshots, and resize the viewport to check responsive and mobile layouts.
- **One server, many browsers** — every install registers with its own browser ID, so one server can drive several browsers side by side.

## Safe by default

- Page access is granted per domain, in the extension's Options page — nothing is readable or scriptable until you approve that domain.
- Every tool has its own on/off switch.
- A local audit log records every command that ran.
- No analytics, no telemetry, no third-party SDKs. The extension declares no data collection; settings and the audit log stay in your browser profile.

## The toolbar button shows where you stand

The fox-tail icon reports the connection to your server: grey when the server is offline, amber while connecting, orange once connected. Hover it for the exact state; clicking it opens Options. If the button lands in the extensions menu instead of the toolbar, pin it there.

## Setup

1. Install this extension.
2. Run the MCP server on your own machine — a prebuilt desktop app from the project's releases, a container image, or a source checkout.
3. Open Options (click the toolbar icon) and set a Browser ID plus the server's WebSocket URL, `ws://127.0.0.1:18789` by default.
4. Point your MCP client at the server's Streamable HTTP endpoint, `http://127.0.0.1:18790/mcp`.

Port 18789 is the extension WebSocket, 18790 is MCP.

Open source under the MIT license — source, attribution and full setup instructions: https://github.com/rtf6x/tail-browser-mcp
```

**Tags:** mcp, ai, automation, developer tools, agent — pick from whatever the form offers.

**Data collection / privacy form:** select "None" for all categories — the extension collects no data itself; declare the local audit log and settings as browser-local storage only, not "collection." Link `PRIVACY_POLICY.md` (raw repository URL) as the privacy policy URL:
```
https://raw.githubusercontent.com/rtf6x/tail-browser-mcp/main/PRIVACY_POLICY.md
```

## Icons

`npm run icons` (`tools/generate-icons.py`) writes 16/32/48/128px PNGs per connection state into `chrome-extension/assets/icons/` and `firefox-extension/assets/icons/` — sufficient for both stores' icon requirements (Chrome needs 128×128 for the store listing itself; reuse or upscale the connected-state icon for that one asset). Both extensions ship the generated PNGs from git; the generator needs Pillow and `rsvg-convert` and is not part of any build.
