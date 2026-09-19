# Tail MCP

[![Mozilla Add-on](https://img.shields.io/amo/v/tail-mcp?label=Firefox%20Add-on&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/)

An MCP server paired with a browser extension (Firefox or Chrome) that lets AI assistants work with your browser locally.

**Why not just use a browser-automation MCP (Playwright, Puppeteer, CDP-driven)?** Those drive a separate, automated browser instance — sites that fingerprint and block bot-controlled browsers (Cloudflare, DataDome, PerimeterX, and most login-walled or anti-scraping pages) detect and block it. Tail MCP is different: it's a real extension running inside **your own, already-logged-in browser**. To the website, the traffic looks exactly like you clicking around — because it is. No `navigator.webdriver` flag, no headless fingerprint, no separate automation profile to re-authenticate. This is the main reason to prefer it over automation-framework MCP servers for anything behind a login or bot-detection wall.

Independent project derived from [eyalzh/browser-control-mcp](https://github.com/eyalzh/browser-control-mcp) — **not affiliated** with the [official AMO add-on](https://addons.mozilla.org/en-US/firefox/addon/browser-control-mcp/). Published under its own AMO listing: [**Tail MCP**](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/). Own extension IDs, HTTP transport for [OpenCode](https://opencode.ai), Docker deployment, and additional page-inspection/manipulation tools (screenshot, scroll-to-element, viewport resize).

## Releases

| Version | Notes |
|---------|--------|
| **[v2.0.10](https://github.com/rtf6x/tail-browser-mcp/releases/tag/v2.0.10)** (current) | Fix: WebSocket server now binds `127.0.0.1` (was `localhost`, which resolved IPv6-only on some machines and silently blocked extension connections) |
| [v2.0.7](https://github.com/rtf6x/tail-browser-mcp/releases/tag/v2.0.7) | Desktop tray app (macOS/Windows/Linux) — bundles the MCP server as a single native binary, no Docker/npm/terminal required |
| [v2.0.0](https://github.com/rtf6x/tail-browser-mcp/releases/tag/v2.0.0) | Rebrand to Tail MCP, own extension IDs, screenshot/scroll/viewport-resize tools |
| [v1.6.1](https://github.com/rtf6x/tail-browser-mcp/releases/tag/v1.6.1) | AMO source archive fix, multi-browser `browserId`, WebSocket URLs, ports 18789/18790 |
| [v1.6.0](https://github.com/rtf6x/tail-browser-mcp/releases/tag/v1.6.0) | First v1.6 release (superseded for AMO re-upload) |

**Extensions:** install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/) (Firefox), or build from this repo — `npm run pack:extensions` (Firefox XPI + AMO source zip + Chrome zip), or load unpacked after `npm run build`.

**MCP server:** `git checkout main` (or a specific [release tag](#releases)), then `npm run docker:up` — or use the [desktop app](#desktop-app-no-docker-no-terminal) instead.

## What it does

- **Tabs** — open, close, list, reorder, group
- **History** — search recent browsing history
- **Pages** — read text/links, find/highlight, scroll to element, run JS, query DOM, read console output, screenshot, resize viewport for responsive testing (with per-domain consent)
- **Local-only** — WebSocket on `127.0.0.1`; optional HMAC secret; no cloud backend

## Architecture

```
                    ┌─────────────────────────────────────┐
  OpenCode          │           MCP Server                │
  Claude / others ─►│  HTTP :18790 (Streamable HTTP)       │
                    │  WebSocket :18789 (browser registry) │
                    └──────────┬────────────┬─────────────┘
                               │            │
                    browserId=A│            │browserId=B
                               ▼            ▼
                         Firefox ext    Chrome ext
                         (Options)      (Options)
```

| Component | Role |
|-----------|------|
| `firefox-extension/` / `chrome-extension/` | Connects via WebSocket; registers `browserId`; runs browser actions |
| `mcp-server/` | MCP tools + WebSocket listener; routes commands by `browserId` |
| `common/` | Shared types, wire format, handshake, extension WebSocket client |

**MCP transport:** Streamable HTTP only, at `dist/http-server.js` (`:18790`). Works with OpenCode, Claude Code, and any MCP client that supports remote/HTTP servers — no stdio process management, no per-client binary.

Port **18789** is the extension WebSocket — **not** MCP. Do not point OpenCode at `:18789`.

**One MCP server ↔ many browser installs.** Each extension registers with a unique `browserId` on the same WebSocket URL. MCP tools accept optional `browserId` (required when more than one browser is connected). See [Multiple browsers, one MCP server](#multiple-browsers-one-mcp-server).

## Supported browsers

| Browser | Extension |
|---------|-----------|
| **Firefox** | [Install from AMO](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/) (v2.0.10), or build from `firefox-extension/` |
| **Chrome / Chromium** | Load unpacked from `chrome-extension/` (Chrome Web Store submission pending) |

Default ports: WebSocket **18789**, MCP HTTP **18790** (registered-user range, avoids crowded 808x dev ports). Health probe uses HTTP port. All browser installs on one server use the same pair.

## MCP tools

All tools can be enabled or disabled individually in the extension options page (`about:addons` → Preferences). Tools marked **consent** require optional host permission and explicit per-domain approval in the extension UI.

| Tool | Description | Consent |
|------|-------------|---------|
| `list-connected-browsers` | Connected installs: `browserId`, label, browser type | — |
| `open-browser-tab` | Open URL (`browserId` if >1 browser) | — |
| `close-browser-tabs` | Close tabs by ID (`browserId` if >1 browser) | — |
| `get-list-of-open-tabs` | List open tabs, paginated | — |
| `get-recent-browser-history` | Search or list recent history | — |
| `reorder-browser-tabs` | Change tab order | — |
| `group-browser-tabs` | Create a tab group | — |
| `get-tab-web-content` | Read page text and links (paginated) | **consent** |
| `find-highlight-in-browser-tab` | Find and highlight text | **consent** |
| `evaluate-script-in-tab` | Run JSON-serializable JS in the page | **consent** |
| `query-dom-in-tab` | CSS selector → text, HTML, or list | **consent** |
| `get-console-messages-in-tab` | Read console output from a tab | **consent** |
| `scroll-to-element-in-tab` | Scroll a CSS selector's element into view | **consent** |
| `capture-screenshot-in-tab` | Screenshot a tab, optionally cropped to an element (Firefox: first use prompts for the broad "access data for all websites" permission — Firefox does not expose tab capture on a narrower per-domain grant) | **consent** |
| `set-viewport-size-in-tab` | Resize a tab's viewport for responsive/mobile testing (Chrome: exact width/height/DPI/mobile emulation via CDP; Firefox: window-resize approximation, `mobile`/`deviceScaleFactor` ignored) | **consent** |

All action tools accept optional **`browserId`**. Omit it when exactly one browser is connected.

The page-inspection and page-manipulation tools (`evaluate-script`, `query-dom`, `get-console-messages`, `capture-screenshot`, `set-viewport-size`) are **disabled by default** in extension settings.

### Example prompts

**Tab management**
- *"Close all tabs I haven't used in 24 hours."*
- *"Group my GitHub tabs into a group called Development."*

**History**
- *"Find articles about L-theanine in my browser history from the last week."*

**Research**
- *"Open HN, read the top story and summarize the comments."*
- *"On the open tab, run a DOM query for all `h2` headings and list them."*
- *"Check console errors on the current page."*
- *"Resize the tab to an iPhone SE viewport and screenshot it to check the mobile layout."*

## Security model

Compared to full browser-automation MCP servers, this stack is designed for use with a personal browser:

- **Localhost-only** — WebSocket on `127.0.0.1:18789`; no shared secret by default
- Optional **`EXTENSION_SECRET`** on the server for HMAC signing
- Per-tool toggles and an audit log in the extension options
- Host permissions and domain consent before reading, scripting, or resizing pages
- No analytics or remote data collection (`data_collection_permissions: none`)
- No runtime third-party dependencies in the shipped extension
- Chrome only: `set-viewport-size-in-tab` requires the `debugger` permission, granted at install (Chrome disallows `debugger` as an optional/toggleable permission) — using it briefly attaches Chrome DevTools Protocol to the target tab

**Caution:** when page tools are enabled, the assistant can execute JavaScript and read page content on domains you approve. Review tool calls and keep sensitive tools disabled if you do not need them.

## Quick start (OpenCode + Docker)

### 1. Get the code

```bash
git clone https://github.com/rtf6x/tail-browser-mcp.git
cd tail-browser-mcp
npm install
npm run build
```

### 2. Install a browser extension

**Firefox** — install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/); for a dev build instead: `about:debugging` → Load Temporary Add-on → `firefox-extension/manifest.json`, or `npm run pack:extensions` (XPI + AMO source zip).

**Chrome** — `chrome://extensions` → Developer mode → Load unpacked → `chrome-extension/`, or use `tail-mcp-chrome.zip` from `npm run pack:extensions`.

Open extension **Options** → set a unique **Browser ID** (auto-generated on first run). WebSocket URL **`ws://127.0.0.1:18789`** (default; use `wss://…` for remote servers).

### 3. Start MCP server

```bash
npm run docker:up
```

No `.env` file required. Verify:

```bash
curl http://127.0.0.1:18790/health
# → {"status":"ok","browsers":[...]}
npm run docker:logs
```

### 4. Configure OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tail-mcp": {
      "type": "remote",
      "url": "http://127.0.0.1:18790/mcp",
      "oauth": false,
      "enabled": true
    }
  }
}
```

Restart OpenCode. One MCP URL: `http://127.0.0.1:18790/mcp`. Call `list-connected-browsers` to see IDs; pass `browserId` in other tools when multiple browsers are connected.

## Desktop app (no Docker, no terminal)

For people who just want to run the server without touching Docker, npm, or a terminal: a tray/menu-bar app that bundles the whole MCP server into a single native binary. Tray-only — it never opens a window and never appears in the Dock/taskbar.

1. Download the build for your OS from the [latest release](../../releases/latest):
   - **macOS** — `Tail MCP_<version>_aarch64.dmg` (Apple Silicon only; Intel Macs build from source)
   - **Windows** — `Tail MCP_<version>_x64-setup.exe`
   - **Linux** — `.AppImage` or `.deb` (community-supported, less tested — please file a bug if something breaks)
2. Install and launch it. A tray/menu-bar icon appears and starts the server automatically (WebSocket on `18789`, MCP HTTP on `18790` — same defaults as the Docker setup).
3. Install a browser extension as in step 2 above and point it at `ws://127.0.0.1:18789`.
4. Right-click the tray icon for status, the list of connected browsers, start/stop, "Launch at startup", log/config file access, and quit. Config (`ws_port`/`http_port`/`secret`) is a plain JSON file — "Reveal config file" opens it; restart the app after editing it.

**Works with any MCP-capable harness**, not just OpenCode — Claude Desktop, Claude Code, Cursor, or anything else that can add a remote/Streamable-HTTP MCP server. The desktop app doesn't care who connects; point any harness at `http://127.0.0.1:18790/mcp` (see [Configure OpenCode](#4-configure-opencode) for the JSON shape, or use the [self-configuring prompt](#any-coding-agent--harness-self-configuring-prompt) so the harness wires itself up). One running desktop app can serve multiple harnesses on the same machine simultaneously — they all share the same browser connections.

**These builds are unsigned** (no Apple/Windows developer certificate). Your OS will warn about an "unidentified developer" / unrecognized app on first launch — this is expected, not a sign of tampering:
- **macOS**: right-click the app → **Open** → **Open** again in the dialog (only needed once). Opening normally via double-click will refuse to launch.
- **Windows**: click **More info** on the SmartScreen prompt → **Run anyway**.

If a coding agent/harness has already cloned this repo and set up the extension, it can equally well `npm run docker:up` (see Quick start above) instead of the desktop app — both expose the identical MCP server on the same ports.

## Multiple browsers, one MCP server

One Docker container serves every browser/profile you want the AI to control.

| Step | Action |
|------|--------|
| 1 | `npm run docker:up` — ports **18789** (WS) / **18790** (MCP HTTP) |
| 2 | Install extension in each browser (Firefox, Chrome, extra profiles…) |
| 3 | In each **Options**: unique **Browser ID**, WebSocket URL **`ws://127.0.0.1:18789`** |
| 4 | OpenCode: one MCP URL `http://127.0.0.1:18790/mcp` |

**Agent workflow**

1. `list-connected-browsers` — see available `browserId` values
2. Pass `browserId` in tool calls when more than one browser is connected
3. Omit `browserId` if only one browser is online

**Example**

```json
"open-browser-tab": {
  "browserId": "browser-chrome-work",
  "url": "https://example.com"
}
```

**Controlling access**

- Don't install the extension in browsers you don't want automated
- Reload extension after changing Browser ID (Options → Save reloads automatically)

Verify connections: `curl http://127.0.0.1:18790/health` → `browsers` array.

## Installation (other clients)

### Any coding agent / harness (self-configuring prompt)

No manual config file editing is needed for agent harnesses that can read/write their own settings (Claude Code, OpenCode, Cursor, etc.). After `npm run docker:up`, paste a prompt like this into the harness:

> Add the MCP server at `http://127.0.0.1:18790/mcp` (Streamable HTTP, no auth) to your MCP configuration under the name `tail-mcp`, then call `list-connected-browsers` to confirm it's reachable.

The agent will find its own MCP config location and wire it up. For the exact JSON shape OpenCode expects, see [Configure OpenCode](#4-configure-opencode) above.

### MCP server without Docker

```bash
cd mcp-server
npm run build
npm start         # HTTP on :18790
```

### Manual Docker run

```bash
docker build -t tail-browser-mcp .
docker run -d --name tail-browser-mcp --restart unless-stopped \
  -p 127.0.0.1:18789:18789 \
  -p 127.0.0.1:18790:18790 \
  -e CONTAINERIZED=true \
  tail-browser-mcp
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXTENSION_SECRET` | *(unset)* | Optional HMAC signing; unset = localhost trust mode |
| `EXTENSION_PORT` | `18789` | WebSocket port (extensions connect here) |
| `MCP_HTTP_PORT` | `18790` | HTTP MCP endpoint (`/mcp`, `/health`) |
| `CONTAINERIZED` | — | Set to `true` in Docker |

## Commands

```bash
npm install              # install all packages
npm run build            # build extension + MCP server

# Extension packages (Firefox XPI + AMO source + Chrome zip)
npm run pack:extensions

# Firefox only
cd firefox-extension && npm run pack-xpi   # also creates ../tail-mcp-firefox-source.zip
cd firefox-extension && npm test

# MCP server
cd mcp-server && npm start          # HTTP on :18790

# Docker
npm run docker:up
npm run docker:down
npm run docker:logs
```

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| OpenCode: failed to get tools | Wrong URL or server down | `http://127.0.0.1:18790/mcp`, not `:18789`. Check `curl …/health` |
| `browsers: []` in health | Extension not connected | Reload extension; WebSocket URL **`ws://127.0.0.1:18789`** in Options |
| Wrong browser targeted | Multiple browsers connected | Call `list-connected-browsers`; pass `browserId` |
| Port 18789 already in use | Stray MCP process/container | `docker compose down`; kill stray `node dist/http-server.js` |
| Unknown command in extension | Old build | Rebuild/reload extension from this repo |
| Page tools fail | Tool off or no consent | Enable in Options; approve domain in extension UI |

After code changes:

```bash
npm run build && npm run docker:up
```

Reload browser extensions after extension code changes.

## Project layout

```
tail-browser-mcp/
├── common/                 # Shared types, wire envelope, WS client
├── firefox-extension/
├── chrome-extension/
├── mcp-server/
├── docker-compose.yml      # single MCP server (18789/18790)
├── Dockerfile
└── .env.example            # optional settings (empty by default)
```

## Roadmap

- **AMO** — live since v2.0.10: [Tail MCP](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/)
- **Chrome Web Store** submission under the `Tail MCP` identity (not yet published — load unpacked or use the zip for now)

## Upstream

This project started as a fork of [eyalzh/browser-control-mcp](https://github.com/eyalzh/browser-control-mcp) and has since diverged into an independent project with its own extension IDs and identity. The official project and [its AMO listing](https://addons.mozilla.org/en-US/firefox/addon/browser-control-mcp/) are maintained separately from this one (published as [tail-mcp](https://addons.mozilla.org/en-US/firefox/addon/tail-mcp/)).

Repository: [github.com/rtf6x/tail-browser-mcp](https://github.com/rtf6x/tail-browser-mcp)

**Additions since the original fork:** multi-browser `browserId` routing, `list-connected-browsers`, localhost trust mode, Chrome extension, HTTP MCP for OpenCode, Docker, page-inspection tools, screenshot/scroll-to-element/viewport-resize tools, full WebSocket URLs in extension options.

## License

MIT (same as upstream). Use at your own risk — MCP tools can control your browser.
