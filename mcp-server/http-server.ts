import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BrowserAPI } from "./browser-api";
import { createBrowserControlServer } from "./mcp-tools";

import { DEFAULT_MCP_HTTP_PORT } from "@tail-browser-mcp/common/ports";

function readHttpConfig() {
  const port = process.env.MCP_HTTP_PORT
    ? parseInt(process.env.MCP_HTTP_PORT, 10)
    : DEFAULT_MCP_HTTP_PORT;
  const host = process.env.CONTAINERIZED ? "0.0.0.0" : "127.0.0.1";
  return { port, host };
}

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "method" in body &&
    (body as { method?: string }).method === "initialize"
  );
}

const browserApi = new BrowserAPI();
const transports = new Map<string, StreamableHTTPServerTransport>();

async function main() {
  await browserApi.init();

  const { port, host } = readHttpConfig();
  const app =
    host === "0.0.0.0"
      ? createMcpExpressApp({
          host,
          allowedHosts: ["127.0.0.1", "localhost", "host.docker.internal"],
        })
      : createMcpExpressApp({ host });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "tail-browser-mcp",
      browsers: browserApi.listConnectedBrowsers(),
    });
  });

  const mcpPostHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (transport) {
              transports.set(id, transport);
            }
          },
        });

        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id) {
            transports.delete(id);
          }
        };

        const server = createBrowserControlServer(browserApi);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else if (sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: Session ID required" },
          id: null,
        });
        return;
      }

      await transport!.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  const mcpGetHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  const mcpDeleteHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", mcpGetHandler);
  app.delete("/mcp", mcpDeleteHandler);

  app.listen(port, host, () => {
    console.error(
      `Tail MCP HTTP server listening on http://${host}:${port}/mcp`
    );
    console.error(
      `Browser extension WebSocket on port ${browserApi.getSelectedPort()}`
    );
  });

  const shutdown = async () => {
    for (const [sessionId, transport] of transports) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }
    transports.clear();
    browserApi.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start HTTP MCP server:", err);
  process.exit(1);
});
