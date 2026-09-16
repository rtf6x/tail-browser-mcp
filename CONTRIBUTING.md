# Contributing to Tail MCP

We welcome pull requests for new features, tools, and bug fixes.

## Development guidelines

### Testing
- Update Firefox extension unit tests when changing extension behavior
- Test MCP HTTP transport with OpenCode (`http://127.0.0.1:18790/mcp`)
- Test stdio transport with Claude Desktop if touching `server.ts`
- Test Firefox and Chrome extensions after WebSocket or handshake changes

### Compatibility
- One MCP server supports multiple browser installs via `browserId`
- Keep wire envelope backward compatible when `EXTENSION_SECRET` is set (HMAC mode)
- Default mode: localhost trust — no secret required

### Security and privacy
- Browser interactions require explicit user consent for page tools
- Do not log page content or credentials
- Minimal extension permissions
- WebSocket binds to `127.0.0.1` only (non-containerized server)

## Getting started

See [README.md](README.md) and [CLAUDE.md](CLAUDE.md).

```bash
npm install
npm run build
npm run docker:up          # MCP server
cd firefox-extension && npm test
```

## Pull request process

1. Fork and branch
2. Change + tests
3. `npm run build` and `cd firefox-extension && npm test`
4. Manual check: extension Options → Browser ID, `curl :18790/health`
5. PR with clear description
