import { browser } from "./browser";
import type { ConnectionStatus } from "@tail-browser-mcp/common/websocket-client";

const ICONS: Record<ConnectionStatus, string> = {
  connected: "connected",
  connecting: "connecting",
  disconnected: "disconnected",
};

const TITLES: Record<ConnectionStatus, string> = {
  connected: "Tail MCP — connected to MCP server",
  connecting: "Tail MCP — connecting…",
  disconnected: "Tail MCP — MCP server offline",
};

function iconPath(name: string, size: 16 | 32 | 48): string {
  return browser.runtime.getURL(`assets/icons/${name}-${size}.png`);
}

export async function updateConnectionIcon(
  status: ConnectionStatus
): Promise<void> {
  const icon = ICONS[status];
  try {
    await browser.action.setIcon({
      path: {
        16: iconPath(icon, 16),
        32: iconPath(icon, 32),
        48: iconPath(icon, 48),
      },
    });
    await browser.action.setTitle({ title: TITLES[status] });
  } catch (error) {
    console.warn("Tail MCP: failed to update toolbar icon", error);
  }
}
