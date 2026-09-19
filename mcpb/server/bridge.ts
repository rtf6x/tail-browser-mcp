/**
 * Stdio -> Streamable HTTP bridge.
 *
 * Hosts such as Claude Desktop can only start local stdio MCP servers, while a
 * Tail MCP server is a single long-running HTTP process that owns the browser
 * registry, the per-browser command queue and the extension WebSocket. This
 * bridge lets such a host speak stdio and forwards every request to that one
 * server, so no second server instance is ever started.
 *
 * Nothing is written to stdout except MCP protocol traffic; all diagnostics go
 * to stderr, which hosts record in their MCP log.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

/** Injected by esbuild from the repository version at build time. */
declare const __TAIL_MCP_VERSION__: string;

/** Browser tools legitimately take minutes (navigation, screenshots, page reads). */
const TOOL_TIMEOUT_MS = 300_000;

const DEFAULT_SERVER_URL = "http://127.0.0.1:18790/mcp";

function log(message: string): void {
  console.error(`tail-mcp: ${message}`);
}

async function main(): Promise<void> {
  const url = process.env.TAIL_MCP_URL?.trim() || DEFAULT_SERVER_URL;

  const upstream = new Client(
    { name: "tail-mcp-bridge", version: __TAIL_MCP_VERSION__ },
    { capabilities: {} },
  );
  upstream.onerror = (error) =>
    log(`server error: ${error instanceof Error ? error.message : String(error)}`);

  try {
    await upstream.connect(new StreamableHTTPClientTransport(new URL(url)));
  } catch (error) {
    log(`cannot reach ${url} — ${error instanceof Error ? error.message : String(error)}`);
    log(
      "start the Tail MCP server first (the Tail MCP tray app, or `npm run docker:up` in the repository), then restart this extension",
    );
    process.exitCode = 1;
    return;
  }

  const available = upstream.getServerCapabilities() ?? {};
  const capabilities: ServerCapabilities = {};
  if (available.tools) capabilities.tools = { listChanged: true };
  if (available.resources) capabilities.resources = { listChanged: true, subscribe: false };
  if (available.prompts) capabilities.prompts = { listChanged: true };

  const downstream = new Server(
    { name: "tail-mcp", version: __TAIL_MCP_VERSION__ },
    { capabilities, instructions: upstream.getInstructions() },
  );

  if (available.tools) {
    downstream.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
      upstream.listTools(request.params, { signal: extra.signal }),
    );
    downstream.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      upstream.callTool(request.params, undefined, {
        signal: extra.signal,
        timeout: TOOL_TIMEOUT_MS,
      }),
    );
  }
  if (available.resources) {
    downstream.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
      upstream.listResources(request.params, { signal: extra.signal }),
    );
    downstream.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) =>
      upstream.listResourceTemplates(request.params, { signal: extra.signal }),
    );
    downstream.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
      upstream.readResource(request.params, { signal: extra.signal }),
    );
  }
  if (available.prompts) {
    downstream.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
      upstream.listPrompts(request.params, { signal: extra.signal }),
    );
    downstream.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
      upstream.getPrompt(request.params, { signal: extra.signal }),
    );
  }

  // Anything the server does not implement fails there too; answer locally so the
  // host gets a protocol error instead of a dropped request.
  downstream.fallbackRequestHandler = async (request) => {
    throw new McpError(ErrorCode.MethodNotFound, `tail-mcp does not support ${request.method}`);
  };

  // The host's own notifications (initialized, cancelled) are handled by the SDK;
  // it advertises no capabilities this bridge could forward upstream.
  downstream.fallbackNotificationHandler = async () => {};

  // List changes are the one server-initiated signal worth passing through, so the
  // host re-reads the tool list when extensions reload.
  upstream.fallbackNotificationHandler = async (notification) => {
    switch (notification.method) {
      case "notifications/tools/list_changed":
        await downstream.sendToolListChanged();
        break;
      case "notifications/resources/list_changed":
        await downstream.sendResourceListChanged();
        break;
      case "notifications/prompts/list_changed":
        await downstream.sendPromptListChanged();
        break;
      default:
        break;
    }
  };

  const shutdown = async (code: number): Promise<void> => {
    await downstream.close().catch(() => undefined);
    await upstream.close().catch(() => undefined);
    process.exit(code);
  };

  // The host died or closed the pipe.
  downstream.onclose = () => void shutdown(0);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(0));
  }

  await downstream.connect(new StdioServerTransport());
  log(`connected to ${url} (v${__TAIL_MCP_VERSION__})`);
}

await main();
