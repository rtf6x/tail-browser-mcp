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

const browserApi = new BrowserAPI();

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

  // Stateless: the tools keep nothing per client (everything shared lives in browserApi), so a
  // server and transport live exactly as long as one request and are released when it closes.
  const mcpPostHandler = async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createBrowserControlServer(browserApi);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
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

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };

  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(port, host, () => {
    console.error(
      `Tail MCP HTTP server listening on http://${host}:${port}/mcp`
    );
    console.error(
      `Browser extension WebSocket on port ${browserApi.getSelectedPort()}`
    );
  });

  const shutdown = () => {
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
