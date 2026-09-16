import type { ServerMessageRequest } from "@tail-browser-mcp/common/server-messages";
import type { ExtensionMessage } from "@tail-browser-mcp/common/extension-messages";
import type { ConnectionStatus } from "@tail-browser-mcp/common/websocket-client";
import { createWebsocketClient } from "./client";
import type { WebsocketClient } from "./client";
import { browser } from "./browser";

const BRIDGE_PORT_NAME = "tail-mcp-bridge";
const BRIDGE_COMMAND_TIMEOUT_MS = 14_000;

const clients: WebsocketClient[] = [];
let activeInitKey = "";
let bridgePort: chrome.runtime.Port | null = null;
let lastBroadcastStatus: ConnectionStatus | null = null;

function aggregateClientStatus(): ConnectionStatus {
  if (clients.length === 0) {
    return "disconnected";
  }
  if (clients.some((client) => client.getStatus() === "connected")) {
    return "connected";
  }
  if (clients.some((client) => client.getStatus() === "connecting")) {
    return "connecting";
  }
  return "disconnected";
}

function broadcastConnectionStatus(): void {
  const status = aggregateClientStatus();
  if (status === lastBroadcastStatus) {
    return;
  }
  lastBroadcastStatus = status;
  void browser.runtime
    .sendMessage({ type: "mcp-connection-status", status })
    .catch(() => {
      // Service worker may be asleep; icon updates on next wake.
    });
}

function initKey(
  wsUrls: string[],
  browserId: string,
  label?: string
): string {
  return `${browserId}\0${label ?? ""}\0${wsUrls.join("\n")}`;
}

function shutdownAllClients(): void {
  for (const client of clients) {
    client.disconnect();
  }
  clients.length = 0;
  lastBroadcastStatus = null;
  broadcastConnectionStatus();
}

function ensureBridgePort(): chrome.runtime.Port {
  if (bridgePort) {
    return bridgePort;
  }
  bridgePort = browser.runtime.connect({ name: BRIDGE_PORT_NAME });
  bridgePort.onDisconnect.addListener(() => {
    bridgePort = null;
  });
  return bridgePort;
}

async function dispatchCommandToServiceWorker(
  clientIndex: number,
  message: ServerMessageRequest,
  wsClient: WebsocketClient
): Promise<void> {
  const requestId = crypto.randomUUID();

  try {
    const port = ensureBridgePort();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        port.onMessage.removeListener(onResult);
        reject(new Error("Service worker did not respond in time"));
      }, BRIDGE_COMMAND_TIMEOUT_MS);

      const onResult = (response: {
        type?: string;
        requestId?: string;
        ok?: boolean;
        error?: string;
      }) => {
        if (
          response?.type !== "mcp-bridge-result" ||
          response.requestId !== requestId
        ) {
          return;
        }
        clearTimeout(timeout);
        port.onMessage.removeListener(onResult);
        if (response.ok) {
          resolve();
          return;
        }
        reject(new Error(response.error ?? "Service worker rejected command"));
      };

      port.onMessage.addListener(onResult);
      port.postMessage({
        type: "mcp-bridge-command",
        requestId,
        clientIndex,
        message,
      });
    });
  } catch (error) {
    console.warn("Tail MCP: failed to forward command to SW", error);
    await wsClient.sendErrorToServer(
      message.correlationId,
      error instanceof Error ? error.message : "Extension service worker unavailable"
    );
  }
}

function initClient(wsUrl: string, browserId: string, label?: string): void {
  const clientIndex = clients.length;
  const wsClient = createWebsocketClient(
    wsUrl,
    browserId,
    "",
    label,
    "chrome"
  );

  wsClient.addMessageListener(async (message: ServerMessageRequest) => {
    await dispatchCommandToServiceWorker(clientIndex, message, wsClient);
  });

  wsClient.addStatusListener(() => {
    broadcastConnectionStatus();
  });

  wsClient.connect();
  clients.push(wsClient);
}

function reconnectAllClients(): void {
  for (const client of clients) {
    if (client.getStatus() !== "connected") {
      client.connect();
    }
  }
}

function applyInit(
  wsUrls: string[],
  browserId: string,
  label?: string
): boolean {
  const key = initKey(wsUrls, browserId, label);
  const alreadyConnected =
    activeInitKey === key &&
    clients.length > 0 &&
    clients.every((client) => client.getStatus() === "connected");

  if (alreadyConnected) {
    ensureBridgePort();
    return false;
  }

  shutdownAllClients();
  activeInitKey = key;
  for (const wsUrl of wsUrls) {
    initClient(wsUrl, browserId, label);
  }
  ensureBridgePort();
  return true;
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  switch (message.type) {
    case "mcp-offscreen-init": {
      const wsUrls = message.wsUrls as string[];
      const browserId = message.browserId as string;
      const label = message.label as string | undefined;
      const created = applyInit(wsUrls, browserId, label);
      sendResponse({ ok: true, created });
      return false;
    }
    case "mcp-offscreen-reconnect": {
      reconnectAllClients();
      ensureBridgePort();
      sendResponse({
        ok: true,
        connected: clients.some((client) => client.getStatus() === "connected"),
      });
      return false;
    }
    case "mcp-offscreen-send-resource": {
      const client = clients[message.clientIndex as number];
      void client
        ?.sendResourceToServer(message.resource as ExtensionMessage)
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          console.warn("Tail MCP: send resource failed", error);
          sendResponse({ ok: false });
        });
      return true;
    }
    case "mcp-offscreen-send-error": {
      const client = clients[message.clientIndex as number];
      void client
        ?.sendErrorToServer(
          message.correlationId as string,
          message.errorMessage as string
        )
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    default:
      return false;
  }
});

void browser.runtime.sendMessage({ type: "mcp-offscreen-ready" });
