# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Installation
```bash
npm install  # Install all dependencies (includes subproject dependencies)
```

### Build
```bash
npm run build  # Build all projects using nx
```

### Individual project builds
```bash
cd mcp-server && npm run build
cd firefox-extension && npm run build
cd chrome-extension && npm run build
cd common && npm install && npm run build   # required before Docker / mcp-server runtime
```

### Test
```bash
cd firefox-extension && npm test
```

### Start MCP Server
```bash
cd mcp-server && npm start          # HTTP on :18790 (OpenCode, Claude Code, any MCP-over-HTTP client)
```

### Docker
```bash
npm run docker:up      # build + start single MCP container (18789/18790)
npm run docker:down
npm run docker:logs
```

## Architecture

Monorepo with four main parts:

1. **mcp-server** — MCP server (Streamable HTTP) and WebSocket listener for browser extensions
2. **firefox-extension** / **chrome-extension** — browser add-ons that execute tab/page actions
3. **common** — shared TypeScript types, WebSocket client, wire envelope, handshake (`browserId` registration)

### Communication flow

```
OpenCode / Claude  ──MCP (Streamable HTTP :18790)──►  mcp-server
                                                      │
                         ws://127.0.0.1:18789         │  Browser registry
              ┌──────────────────────────────────────┤  (browserId → WebSocket)
              ▼                    ▼                 ▼
         Firefox ext           Chrome ext        … more installs
         browserId=A           browserId=B
```

- **One MCP server, many browsers.** Each extension registers with a unique `browserId` on connect.
- MCP tools take optional `browserId` (required when >1 browser connected). Use `list-connected-browsers` first.
- Per-browser request queue on the server (sequential commands per browser).

### Key files

| Path | Role |
|------|------|
| `mcp-server/http-server.ts` | HTTP MCP transport (OpenCode, Claude Code, etc.) |
| `mcp-server/browser-api.ts` | WebSocket server, browser registry, routing |
| `mcp-server/mcp-tools.ts` | MCP tool definitions |
| `common/handshake-messages.ts` | `register` / `register-ack`, `browserId` validation |
| `common/wire-envelope.ts` | JSON message envelope (optional HMAC) |
| `common/websocket-client.ts` | Extension-side WS client |
| `firefox-extension/background.ts` | Extension init + WS connect |
| `firefox-extension/message-handler.ts` | Command dispatch |

### Authentication

**Default: localhost trust mode** — no `EXTENSION_SECRET` required. Server binds to `127.0.0.1`; extensions connect to `ws://127.0.0.1:18789`.

Optional: set `EXTENSION_SECRET` in the MCP server env to enable HMAC signing on WebSocket messages.

### Extension configuration (Options page)

- **Browser ID** — unique per install (`chrome`, `browser-a1b2c3d4`, …)
- **WebSocket URL** — default `ws://127.0.0.1:18789` (same for all installs on one server)
- **Tool toggles**, domain deny list, audit log

### Development notes

- esbuild for extensions; tsc for mcp-server and common
- Jest tests in firefox-extension only
- Nx monorepo orchestration
- Docker: builds `common/` then `mcp-server/` (see `Dockerfile`)
- Page tools require per-domain user consent in the extension
