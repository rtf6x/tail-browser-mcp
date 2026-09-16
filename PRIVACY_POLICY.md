# Tail MCP — Privacy Policy

Last updated: 2026-09-16

Tail MCP is a browser extension paired with a local MCP server that lets an AI assistant (Claude, OpenCode, or another MCP client) control your browser — opening tabs, reading page content, and similar actions you explicitly enable.

## What data the extension handles

- **Browser data it can access, only for tools you enable:** open tabs, tab groups, browsing history, and — with your explicit per-domain consent — the text, DOM, and console output of pages you approve.
- **Extension settings:** a self-chosen Browser ID, WebSocket server URL, per-tool on/off switches, a per-domain consent list, and a local audit log of executed commands. Stored using the browser's local extension storage.
- **Audit log:** kept locally in the browser only, for your own visibility into what commands ran. Never transmitted anywhere by the extension itself.

## What Tail MCP does NOT do

- **No remote servers.** The extension talks only to a WebSocket server you run yourself, by default on `127.0.0.1` (your own machine). No Tail MCP-operated cloud service exists.
- **No analytics, telemetry, or tracking.** No usage data, crash reports, or identifiers are collected or sent anywhere.
- **No selling or sharing of data.** There is no data collection to sell or share — the extension has no backend of its own.
- **No third-party services.** The shipped extension bundles no third-party SDKs, analytics libraries, or trackers.

## Data flow

```
AI assistant (Claude/OpenCode) → local MCP server (your machine) → WebSocket → browser extension → browser APIs
```

Every hop above stays on infrastructure you control (your own machine, or a server you deploy yourself). The MCP server optionally signs WebSocket messages with a shared secret (`EXTENSION_SECRET`) you set; this is a local integrity check, not data sent to any third party.

## Permissions

The extension requests only the browser permissions its enabled tools need (tabs, tab groups, history, storage, scripting, alarms; Chrome additionally requires the `debugger` permission for the optional viewport-resize tool, used only while that tool runs on a tab). Page-content tools require you to grant per-domain host permission and explicitly approve the domain in the extension's options UI before any page is read or scripted.

## Changes

Any future change to this policy will be reflected in this file in the project repository: https://github.com/rtf6x/tail-browser-mcp

## Contact

Issues or questions: https://github.com/rtf6x/tail-browser-mcp/issues
