# Plan request: harness emulation and inspection tools

Status: proposed. Nothing here is implemented yet.

## Why

Driving a real browser is what this server is for, but a few states a page has to
be tested in cannot be reached with the tools it ships today. The gap turned up
while fixing the hero intro on rootfox.cc: the CSS branch under
`prefers-reduced-motion: reduce` and the `<noscript>` branch could only be
checked by reading the cascade, the cold-load timings of 76 flame frames could
not be measured at all, and there was no way to see what the page requested or
how long it took.

| Wanted | Today |
|---|---|
| `prefers-reduced-motion`, `prefers-color-scheme`, `forced-colors` | not reachable |
| Scripts off (the `<noscript>` path) | not reachable |
| Cold cache, slow or offline network | not reachable |
| Request log: URLs, statuses, sizes, timings | only `performance` entries through `evaluate-script-in-tab` |
| A fixed timezone or locale ("is it night where the page thinks it is?") | not reachable |
| A slow CPU, to see an animation under load | not reachable |

## Tools requested

1. `set-emulated-media-in-tab` — `Emulation.setEmulatedMedia`: media features
   (`prefers-reduced-motion`, `prefers-color-scheme`, `forced-colors`,
   `prefers-contrast`) and media type. `reset: true` (or omitting the feature)
   returns the tab to the real environment.
2. `set-script-execution-in-tab` — `Emulation.setScriptExecutionDisabled`, with
   `reload` so the caller can land on a genuinely script-less document instead
   of a page whose scripts already ran.
3. `set-network-conditions-in-tab` — `Network.enable`, then
   `Network.setCacheDisabled` and `Network.emulateNetworkConditions`
   (offline / latency / download / upload throughput).
4. `get-network-log-in-tab` — the requests the tab made: URL, method, status,
   MIME type, encoded size, start and end time. Sources: the `Network.*` events
   once enabled, or the page's own `performance.getEntriesByType('resource')`
   for the simple case.
5. `set-time-overrides-in-tab` — `Emulation.setTimezoneOverride` and
   `Emulation.setLocaleOverride`; `Emulation.setVirtualTimePolicy` as a
   follow-up if a frozen or advanced clock turns out to be wanted.
6. `set-cpu-throttling-in-tab` — `Emulation.setCPUThrottlingRate`, to watch an
   animation under load.

All six are Chrome-only: they are the DevTools protocol. On Firefox they must
answer with an explicit unsupported error. A silent no-op is the one outcome
that must not happen — a model that reads "ok" goes on to believe the page was
tested in reduced-motion when it never was.

## Implementation map

- `common/server-messages.ts` — one message interface per command, added to the
  `ServerMessage` union, plus the result resources they answer with.
- `mcp-server/browser-api.ts` — one method per command, following
  `setViewportSize` (`sendAndWaitForResponse` with the matching resource).
- `mcp-server/mcp-tools.ts` — register each tool with a description that states
  Chrome-only, and a schema mirroring the CDP call; report the applied value the
  way the viewport tool reports `method=cdp`.
- `chrome-extension/extension-config.ts` — a per-tool permission for each
  (`set-emulated-media-in-tab`, `set-script-execution-in-tab`, …), default on,
  plus `COMMAND_TO_TOOL_ID` entries. The `debugger` permission the viewport tool
  already requires covers these.
- `chrome-extension/message-handler.ts` — handlers next to the viewport one, on
  the shared `debuggerAttachedTabs` attach path; clear every override and detach
  on `reset`, and on tab close or navigation, so a tab is never left emulated.
- `firefox-extension/message-handler.ts` — return the unsupported error for each
  new command.
- `README.md` — tool list and Roadmap; `CLAUDE.md` if the permission model or the
  architecture notes change.

## Invariants

- Every emulation is reversible: reset restores the real environment and detaches
  the debugger.
- No tab is left with an override after it is closed, navigated, or the extension
  loses the debugger attachment.
- One debugger attachment per tab, shared by all emulation tools.
- The per-tool permission stays the gate: a tool the user switched off in the
  options page must not be reachable through another tool.
- Firefox answers "unsupported"; it never reports success it did not perform.

## Verification

- Chrome, on rootfox.cc: reduced-motion on flips the CSS branch (read the
  computed styles of `.fi-scene`), scripts off shows the `<noscript>` layout, a
  cache-disabled reload reports the 76 flame frames with cold timings, and the
  network log lists their sizes.
- Firefox: each new tool answers with the unsupported error.
- `set-viewport-size-in-tab` still works, since it shares the attach path.
- The existing audit log records the new tools like the rest.
