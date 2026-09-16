import { DEFAULT_WS_PORT } from "./ports";

/** Default WebSocket endpoint for local MCP server. */
export const DEFAULT_WS_URL = `ws://127.0.0.1:${DEFAULT_WS_PORT}`;

export function portToWsUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

/** Normalize and validate a WebSocket URL (bare port accepted as shorthand for localhost). */
export function normalizeWsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty WebSocket URL");
  }

  if (/^\d+$/.test(trimmed)) {
    const port = parseInt(trimmed, 10);
    if (port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${trimmed}. Ports must be between 1 and 65535.`);
    }
    return portToWsUrl(port);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid WebSocket URL: ${raw}`);
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`WebSocket URL must use ws:// or wss:// (got ${url.protocol})`);
  }

  url.hash = "";
  url.search = "";
  if (url.pathname === "/") {
    url.pathname = "";
  }

  return url.href.replace(/\/$/, "");
}

/** Derive MCP HTTP /health URL from a WebSocket endpoint. */
export function healthUrlFromWsUrl(wsUrl: string): string {
  const url = new URL(normalizeWsUrl(wsUrl));
  const healthUrl = new URL(url.href);
  healthUrl.protocol = url.protocol === "wss:" ? "https:" : "http:";
  healthUrl.pathname = "/health";
  healthUrl.search = "";
  healthUrl.hash = "";

  // Tail MCP convention: HTTP (incl. /health) is on WS port + 1 when port is explicit.
  if (url.port) {
    healthUrl.port = String(parseInt(url.port, 10) + 1);
  }

  return healthUrl.toString();
}

/** Parse comma- or newline-separated WebSocket URLs. */
export function parseWsUrlList(text: string): string[] {
  const parts = text
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("At least one WebSocket URL must be specified.");
  }

  const urls = parts.map(normalizeWsUrl);
  return [...new Set(urls)];
}

/** Host permission patterns needed for fetch health probe and WebSocket. */
export function hostPermissionsForWsUrls(wsUrls: string[]): string[] {
  const patterns = new Set<string>();
  for (const wsUrl of wsUrls) {
    const url = new URL(normalizeWsUrl(wsUrl));
    const httpScheme = url.protocol === "wss:" ? "https" : "http";
    patterns.add(`${httpScheme}://${url.host}/*`);
  }
  return [...patterns];
}
